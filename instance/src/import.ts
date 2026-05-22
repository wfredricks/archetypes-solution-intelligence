/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.4.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"What the contract requires the
 *   substrate to grow" — surface #2: `si instance import`.
 *
 *   Ownership: asi-local. Lifts to canonical reference-impl.
 */

/**
 * `importInstance` — consumes a tarball produced by `exportInstance`,
 * validates the schema-version stamp, applies any required migrations
 * from the catalog (currently empty), restores the SIG + audit ledger
 * + identity grants into the target backend, and records an
 * `instance.import.completed` event in the new audit ledger.
 *
 * Refuses to import into a non-empty instance without `--force`.
 *
 * @module import
 */

import { execFile } from 'node:child_process';
import {
  appendFile,
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

import { readJsonl } from './format.js';
import type { EdgeRow, NodeRow } from './format.js';
import {
  type ManifestV1,
  readManifest,
} from './manifest.js';
import { findMigrationChain } from './migrations/index.js';

const execFileP = promisify(execFile);

export interface ImportOptions {
  /** Path to the tarball produced by `exportInstance`. */
  input: string;
  /** Target namespace. Should match the manifest's namespace (warning otherwise). */
  namespace: string;
  /** Backend selector for the TARGET. May differ from source per doctrine. */
  backend: 'polygraph' | 'neo4j';
  /** Leveldb directory when backend = 'polygraph'. */
  polygraphPath?: string;
  /** Bolt URL when backend = 'neo4j'. */
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  /** Where to restore the audit ledger (append) and emit the import event. */
  auditPath?: string;
  /** Where to restore the identity grants (append). */
  grantsPath?: string;
  /** Substrate version doing the import (for migration lookup). */
  substrateVersion: string;
  /** Allow import into a non-empty instance. */
  force?: boolean;
  /** Free-form actor identifier (e.g. 'asi instance import'). */
  performedBy?: string;
}

export interface ImportResult {
  manifest: ManifestV1;
  nodesImported: number;
  edgesImported: number;
  auditEventsAppended: number;
  identityGrantsAppended: number;
  migrationsApplied: number;
  /** Original-id → new-id map for relationships when the backend mints new ones. */
  edgeIdMap: Record<string, string>;
  /**
   * Original-id → new-id map for nodes when the backend mints new
   * ones (Neo4j path). PolyGraph preserves ids natively; this is
   * empty there.
   */
  nodeIdMap: Record<string, string>;
  warnings: string[];
}

/** Per-backend import writer contract. */
interface BackendWriter {
  readonly kind: 'polygraph' | 'neo4j';
  /** Returns true if the target instance is empty (no nodes in the namespace). */
  isEmpty(namespace: string): Promise<boolean>;
  /** Apply a node row; returns the id the backend actually assigned. */
  writeNode(row: NodeRow): Promise<string>;
  /** Apply an edge row; returns the id the backend actually assigned. */
  writeEdge(row: EdgeRow, nodeIdMap: Record<string, string>): Promise<string>;
  close(): Promise<void>;
}

export async function importInstance(opts: ImportOptions): Promise<ImportResult> {
  validateImportOptions(opts);
  const performedBy = opts.performedBy ?? '@asi/instance';

  // Stage the tarball into a tmp directory.
  const staging = await mkdtemp(join(tmpdir(), 'asi-instance-import-'));
  try {
    await execFileP('tar', ['-xzf', opts.input, '-C', staging]);

    // Validate the manifest.
    const manifest = await readManifest(join(staging, 'manifest.json'));

    // Find the migration chain. For Phase 3 the catalog is empty;
    // an exact match returns [], a mismatch throws.
    const chain = findMigrationChain(
      manifest.instanceSchemaVersion,
      opts.substrateVersion,
    );

    // Open the target backend writer + check empty-or-force.
    const writer = await openWriter(opts);
    const warnings: string[] = [];
    const nodeIdMap: Record<string, string> = {};
    const edgeIdMap: Record<string, string> = {};
    let nodesImported = 0;
    let edgesImported = 0;
    let auditEventsAppended = 0;
    let identityGrantsAppended = 0;
    try {
      if (!opts.force) {
        const empty = await writer.isEmpty(opts.namespace);
        if (!empty) {
          throw new Error(
            `importInstance: target namespace '${opts.namespace}' is non-empty. ` +
              `Pass force=true to overlay.`,
          );
        }
      }

      if (manifest.namespace !== opts.namespace) {
        warnings.push(
          `manifest namespace '${manifest.namespace}' differs from target namespace ` +
            `'${opts.namespace}'; properties on imported nodes are kept verbatim.`,
        );
      }

      // Apply the nodes.
      for await (const row of readJsonl<NodeRow>(join(staging, 'sig', 'nodes.jsonl'))) {
        const assignedId = await writer.writeNode(row);
        if (assignedId !== row.id) nodeIdMap[row.id] = assignedId;
        nodesImported++;
      }

      // Apply the edges. The writer remaps endpoint ids via nodeIdMap.
      for await (const row of readJsonl<EdgeRow>(join(staging, 'sig', 'edges.jsonl'))) {
        try {
          const assignedId = await writer.writeEdge(row, nodeIdMap);
          if (assignedId !== row.id) edgeIdMap[row.id] = assignedId;
          edgesImported++;
        } catch (err) {
          warnings.push(
            `edge '${row.id}' (${row.type}) could not be applied: ${(err as Error).message}`,
          );
        }
      }

      // Append audit + grants.
      const stagedAudit = join(staging, 'audit', 'audit.jsonl');
      if (opts.auditPath && existsSync(stagedAudit)) {
        await mkdir(dirname(opts.auditPath), { recursive: true });
        const incoming = await readFile(stagedAudit, 'utf8');
        if (incoming.length > 0) {
          await appendFile(opts.auditPath, incoming, 'utf8');
          auditEventsAppended = countNonEmptyLines(incoming);
        }
      }
      const stagedGrants = join(staging, 'identity', 'grants.jsonl');
      if (opts.grantsPath && existsSync(stagedGrants)) {
        await mkdir(dirname(opts.grantsPath), { recursive: true });
        const incoming = await readFile(stagedGrants, 'utf8');
        if (incoming.length > 0) {
          await appendFile(opts.grantsPath, incoming, 'utf8');
          identityGrantsAppended = countNonEmptyLines(incoming);
        }
      }

      // Emit the import-completed event.
      if (opts.auditPath) {
        await mkdir(dirname(opts.auditPath), { recursive: true });
        const event = {
          eventType: 'instance.import.completed',
          recordedAt: new Date().toISOString(),
          actor: performedBy,
          namespace: opts.namespace,
          sourceManifest: {
            substrateVersion: manifest.substrateVersion,
            instanceSchemaVersion: manifest.instanceSchemaVersion,
            backend: manifest.backend,
            nodeCount: manifest.nodeCount,
            edgeCount: manifest.edgeCount,
            sigChecksum: manifest.sigChecksum,
            createdAt: manifest.createdAt,
          },
          targetBackend: opts.backend,
          nodesImported,
          edgesImported,
          migrationsApplied: chain.length,
          warningCount: warnings.length,
        };
        const fileExists = existsSync(opts.auditPath);
        if (!fileExists) {
          await writeFile(opts.auditPath, JSON.stringify(event) + '\n', 'utf8');
        } else {
          await appendFile(opts.auditPath, JSON.stringify(event) + '\n', 'utf8');
        }
      }
    } finally {
      await writer.close();
    }

    return {
      manifest,
      nodesImported,
      edgesImported,
      auditEventsAppended,
      identityGrantsAppended,
      migrationsApplied: chain.length,
      edgeIdMap,
      nodeIdMap,
      warnings,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function validateImportOptions(opts: ImportOptions): void {
  if (!opts.input) throw new Error('importInstance: input path is required');
  if (!existsSync(opts.input)) {
    throw new Error(`importInstance: input '${opts.input}' does not exist`);
  }
  if (!opts.namespace) throw new Error('importInstance: namespace is required');
  if (opts.backend !== 'polygraph' && opts.backend !== 'neo4j') {
    throw new Error(
      `importInstance: backend must be 'polygraph' or 'neo4j' (got '${opts.backend}')`,
    );
  }
  if (opts.backend === 'polygraph' && !opts.polygraphPath) {
    throw new Error('importInstance: polygraphPath is required when backend = "polygraph"');
  }
  if (opts.backend === 'neo4j' && !opts.graphUrl) {
    throw new Error('importInstance: graphUrl is required when backend = "neo4j"');
  }
  if (!opts.substrateVersion) {
    throw new Error('importInstance: substrateVersion is required (for migration lookup)');
  }
}

async function openWriter(opts: ImportOptions): Promise<BackendWriter> {
  if (opts.backend === 'polygraph') {
    const { openPolyGraphWriter } = await import('./backends/polygraph-writer.js');
    return openPolyGraphWriter(opts.polygraphPath!);
  }
  const { openNeo4jWriter } = await import('./backends/neo4j-writer.js');
  return openNeo4jWriter({
    graphUrl: opts.graphUrl!,
    graphUser: opts.graphUser,
    graphPass: opts.graphPass,
  });
}

function countNonEmptyLines(s: string): number {
  let n = 0;
  for (const line of s.split('\n')) if (line.trim().length > 0) n++;
  return n;
}
