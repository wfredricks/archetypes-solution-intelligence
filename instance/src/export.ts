/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.2/§3.3.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"What the contract requires the
 *   substrate to grow" — surface #1: `si instance export`.
 *
 *   Ownership: asi-local. Lifts to canonical reference-impl with
 *   @adopt: markers for default paths.
 */

/**
 * `exportInstance` — produces a tar.gz containing:
 *
 *   manifest.json                  schema-version stamp + counts
 *   sig/nodes.jsonl                every node, properties verbatim
 *   sig/edges.jsonl                every edge, properties verbatim
 *   audit/audit.jsonl              copied if source file exists
 *   identity/grants.jsonl          copied if source file exists
 *   config/resolved-markers.json   present iff resolved-markers were provided
 *
 * Backend-agnostic on the wire: nodes.jsonl + edges.jsonl have the
 * same shape whether the source is PolyGraph or Neo4j.
 *
 * @module export
 */

import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { sha256OfFiles } from './checksum.js';
import {
  type EdgeRow,
  type NodeRow,
  writeEdgesJsonl,
  writeNodesJsonl,
} from './format.js';
import {
  EXPORT_SCHEMA_VERSION,
  type ManifestV1,
  makeManifest,
  writeManifest,
} from './manifest.js';

const execFileP = promisify(execFile);

/** Options for `exportInstance`. */
export interface ExportOptions {
  /** Absolute or relative path the tarball will be written to. */
  output: string;
  /** Solution namespace to export (e.g. 'asi', 'dla-stores'). */
  namespace: string;
  /** Backend selector. */
  backend: 'polygraph' | 'neo4j';
  /** Leveldb directory when backend = 'polygraph'. Ignored otherwise. */
  polygraphPath?: string;
  /** Bolt URL when backend = 'neo4j'. Ignored otherwise. */
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  /**
   * Path to the audit ledger to include in `audit/audit.jsonl`. If the
   * file does not exist, an empty audit.jsonl is written and the
   * manifest's auditEventCount is 0.
   */
  auditPath?: string;
  /**
   * Path to the identity grants ledger to include in
   * `identity/grants.jsonl`. If the file does not exist, an empty
   * grants.jsonl is written and the manifest's identityGrantCount is 0.
   */
  grantsPath?: string;
  /**
   * Path to `.si/config.yaml` or equivalent. The raw bytes are
   * emitted as `config/resolved-markers.json` (the YAML is parsed
   * to JSON for portability). If absent, no config file is emitted.
   */
  resolvedMarkersPath?: string;
  /** Substrate version that produced this export. */
  substrateVersion: string;
  /** Instance schema version (drives migrations on import). */
  instanceSchemaVersion: string;
  /** Free-form actor identifier (e.g. 'asi instance export'). */
  createdBy?: string;
}

/** Result returned by `exportInstance`. */
export interface ExportArtifact {
  /** Absolute path to the produced tar.gz. */
  outputPath: string;
  /** Manifest written into the archive. */
  manifest: ManifestV1;
}

/** Per-backend export reader contract. */
interface BackendReader {
  readonly kind: 'polygraph' | 'neo4j';
  /** Yield every node in the instance, in a stable order. */
  readNodes(namespace: string): AsyncGenerator<NodeRow>;
  /** Yield every edge in the instance, in a stable order. */
  readEdges(namespace: string): AsyncGenerator<EdgeRow>;
  /** Release resources. Idempotent. */
  close(): Promise<void>;
}

/** Produce a whole-instance snapshot tarball. */
export async function exportInstance(opts: ExportOptions): Promise<ExportArtifact> {
  validateExportOptions(opts);
  const createdAt = new Date().toISOString();
  const createdBy = opts.createdBy ?? '@asi/instance';

  // Stage in a tmp directory so partial failures don't leave a
  // half-built tarball on disk.
  const staging = await mkdtemp(join(tmpdir(), 'asi-instance-export-'));
  try {
    await mkdir(join(staging, 'sig'), { recursive: true });
    await mkdir(join(staging, 'audit'), { recursive: true });
    await mkdir(join(staging, 'identity'), { recursive: true });
    await mkdir(join(staging, 'config'), { recursive: true });

    // Open the backend reader.
    const reader = await openReader(opts);
    let nodeCount = 0;
    let edgeCount = 0;
    try {
      // Why materialize-then-sort: the SIG checksum has to be stable
      // across re-exports of the same instance. PolyGraph and Neo4j
      // each have their own iteration order; sorting in the exporter
      // makes the on-disk bytes deterministic.
      const nodes: NodeRow[] = [];
      for await (const n of reader.readNodes(opts.namespace)) nodes.push(n);
      nodes.sort(compareNodes);
      nodeCount = await writeNodesJsonl(join(staging, 'sig', 'nodes.jsonl'), nodes);

      const edges: EdgeRow[] = [];
      for await (const e of reader.readEdges(opts.namespace)) edges.push(e);
      edges.sort(compareEdges);
      edgeCount = await writeEdgesJsonl(join(staging, 'sig', 'edges.jsonl'), edges);
    } finally {
      await reader.close();
    }

    // Copy the audit ledger if present, else write empty.
    let auditEventCount = 0;
    const auditDest = join(staging, 'audit', 'audit.jsonl');
    if (opts.auditPath && existsSync(opts.auditPath)) {
      await copyFile(opts.auditPath, auditDest);
      auditEventCount = await countLines(auditDest);
    } else {
      await writeFile(auditDest, '', 'utf8');
    }

    // Copy the identity grants ledger if present, else write empty.
    let identityGrantCount = 0;
    const grantsDest = join(staging, 'identity', 'grants.jsonl');
    if (opts.grantsPath && existsSync(opts.grantsPath)) {
      await copyFile(opts.grantsPath, grantsDest);
      identityGrantCount = await countLines(grantsDest);
    } else {
      await writeFile(grantsDest, '', 'utf8');
    }

    // Emit resolved markers if a config path was supplied.
    // We keep the original file bytes verbatim under .yaml or .json
    // depending on extension; we do NOT parse-and-rewrite, so an
    // operator inspecting the export sees exactly what was on disk.
    if (opts.resolvedMarkersPath && existsSync(opts.resolvedMarkersPath)) {
      const raw = await readFile(opts.resolvedMarkersPath, 'utf8');
      // The doctrine says "JSON for portability." Emit as JSON when
      // the source is JSON; otherwise emit a thin JSON envelope that
      // carries the original text. This preserves reversibility — an
      // operator can re-emit the original file from the envelope.
      const isJson = opts.resolvedMarkersPath.endsWith('.json');
      const envelope = isJson
        ? raw
        : JSON.stringify(
            {
              format: 'raw',
              source: opts.resolvedMarkersPath,
              content: raw,
            },
            null,
            2,
          ) + '\n';
      await writeFile(join(staging, 'config', 'resolved-markers.json'), envelope, 'utf8');
    }

    // sha256 over the SIG portion (nodes.jsonl + edges.jsonl).
    const sigChecksum = await sha256OfFiles([
      join(staging, 'sig', 'nodes.jsonl'),
      join(staging, 'sig', 'edges.jsonl'),
    ]);

    // Write the manifest.
    const manifest = makeManifest({
      substrateVersion: opts.substrateVersion,
      instanceSchemaVersion: opts.instanceSchemaVersion,
      namespace: opts.namespace,
      backend: opts.backend,
      createdAt,
      createdBy,
      nodeCount,
      edgeCount,
      auditEventCount,
      identityGrantCount,
      sigChecksum,
    });
    await writeManifest(join(staging, 'manifest.json'), manifest);

    // Tar + gzip into the output path.
    await mkdir(dirname(opts.output), { recursive: true });
    await execFileP('tar', ['-czf', opts.output, '-C', staging, '.']);

    return { outputPath: opts.output, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function validateExportOptions(opts: ExportOptions): void {
  if (!opts.output) throw new Error('exportInstance: output path is required');
  if (!opts.namespace) throw new Error('exportInstance: namespace is required');
  if (opts.backend !== 'polygraph' && opts.backend !== 'neo4j') {
    throw new Error(
      `exportInstance: backend must be 'polygraph' or 'neo4j' (got '${opts.backend}')`,
    );
  }
  if (opts.backend === 'polygraph' && !opts.polygraphPath) {
    throw new Error('exportInstance: polygraphPath is required when backend = "polygraph"');
  }
  if (opts.backend === 'neo4j' && !opts.graphUrl) {
    throw new Error('exportInstance: graphUrl is required when backend = "neo4j"');
  }
  if (!opts.substrateVersion) {
    throw new Error('exportInstance: substrateVersion is required (manifest stamp)');
  }
  if (!opts.instanceSchemaVersion) {
    throw new Error(
      'exportInstance: instanceSchemaVersion is required (drives import-time migrations)',
    );
  }
  // Why we check EXPORT_SCHEMA_VERSION is exported: a downstream
  // consumer might want to assert it matches an expected value before
  // shipping an artifact. Keeping the import statement live above
  // makes the symbol available without `import type`.
  if (!EXPORT_SCHEMA_VERSION) {
    throw new Error('exportInstance: EXPORT_SCHEMA_VERSION not initialized');
  }
}

async function openReader(opts: ExportOptions): Promise<BackendReader> {
  if (opts.backend === 'polygraph') {
    const { openPolyGraphReader } = await import('./backends/polygraph-reader.js');
    return openPolyGraphReader(opts.polygraphPath!);
  }
  const { openNeo4jReader } = await import('./backends/neo4j-reader.js');
  return openNeo4jReader({
    graphUrl: opts.graphUrl!,
    graphUser: opts.graphUser,
    graphPass: opts.graphPass,
  });
}

/**
 * Stable node ordering: by primary label, then by id. Both axes are
 * stringly comparable so this is deterministic across re-exports.
 *
 * // Why primary-label-first: when the SIG is partially homogeneous
 * // (many `/code` nodes followed by a few `/contract` nodes), grouping
 * // by label first keeps the on-disk file human-scannable.
 */
function compareNodes(a: NodeRow, b: NodeRow): number {
  const al = a.labels[0] ?? '';
  const bl = b.labels[0] ?? '';
  if (al !== bl) return al < bl ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Stable edge ordering: by type, then by startNode, then by endNode,
 * then by id. Ties are broken by id so duplicates would still order
 * consistently (we don't expect duplicates).
 */
function compareEdges(a: EdgeRow, b: EdgeRow): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  if (a.startNode !== b.startNode) return a.startNode < b.startNode ? -1 : 1;
  if (a.endNode !== b.endNode) return a.endNode < b.endNode ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Count non-empty lines in a JSONL file. */
async function countLines(path: string): Promise<number> {
  const raw = await readFile(path, 'utf8');
  if (raw.length === 0) return 0;
  let n = 0;
  for (const line of raw.split('\n')) {
    if (line.trim().length > 0) n++;
  }
  return n;
}
