/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.1.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Schema versioning" — every
 *   export carries a schema-version stamp so a migration handle is
 *   available when one is needed.
 *
 *   Ownership: asi-local. Lifts to canonical
 *   archetypes/solution-intel/reference-impl/instance/src/manifest.ts.
 */

/**
 * Manifest types + read/write helpers.
 *
 * The manifest is a single `manifest.json` at the root of the export
 * tarball. It carries the schema-version stamp, the per-instance
 * identity (namespace, backend), and aggregate counts that an importer
 * can sanity-check before applying.
 *
 * @module manifest
 */

import { readFile, writeFile } from 'node:fs/promises';

/**
 * The export envelope schema version. This is the version of the
 * EXPORT FORMAT itself, not the substrate. Bumped only when the
 * shape of the tarball (file layout, manifest fields, jsonl rows)
 * changes incompatibly.
 *
 * v0.1.0 (Phase 3, 2026-05-22): initial whole-instance snapshot
 *                                 format. nodes.jsonl + edges.jsonl,
 *                                 audit.jsonl optional, grants.jsonl
 *                                 optional, resolved-markers.json
 *                                 optional.
 */
export const EXPORT_SCHEMA_VERSION = '0.1.0';

/**
 * The manifest schema. One per export tarball.
 *
 * // Why so many version fields: the substrate-version vs. instance-
 * // schema-version distinction is real — a substrate at v0.2.0-pre
 * // can still be producing exports whose internal SIG shape is the
 * // baseline (v0.2.0-pre). When the first schema migration ships,
 * // the two diverge.
 * //
 * // Why aggregate counts: importers compare manifest counts vs.
 * // jsonl line counts as a first-pass corruption check before doing
 * // the full restore.
 */
export interface ManifestV1 {
  /**
   * The version of THIS file layout. Importers refuse exports whose
   * `exportSchemaVersion` they don't recognize.
   */
  readonly exportSchemaVersion: string;
  /** Substrate name (today: always 'solution-intel'). */
  readonly substrateName: string;
  /** Substrate version that produced the export. */
  readonly substrateVersion: string;
  /** SIG instance schema version (the v that migrations bridge). */
  readonly instanceSchemaVersion: string;
  /** The Solution namespace exported (e.g. 'asi', 'dla-stores'). */
  readonly namespace: string;
  /** The backend that produced the export. */
  readonly backend: 'polygraph' | 'neo4j';
  /** ISO-8601 timestamp when the export began. */
  readonly createdAt: string;
  /** Who/what produced the export (e.g. 'asi instance export'). */
  readonly createdBy: string;
  /** Total node count written to sig/nodes.jsonl. */
  readonly nodeCount: number;
  /** Total edge count written to sig/edges.jsonl. */
  readonly edgeCount: number;
  /** Total audit event count written to audit/audit.jsonl (0 if absent). */
  readonly auditEventCount: number;
  /** Total identity grant count written to identity/grants.jsonl (0 if absent). */
  readonly identityGrantCount: number;
  /**
   * sha256 over `sig/nodes.jsonl` + `sig/edges.jsonl` concatenated in
   * that order. Used for idempotency checks — re-exporting a round-
   * tripped instance must produce the same hash.
   *
   * Format: `sha256:<lowercase-hex>`.
   */
  readonly sigChecksum: string;
}

export const SUBSTRATE_NAME = 'solution-intel';

/**
 * Construct a manifest with all required fields. Helper used by the
 * exporter so manifest-shape changes only need one update site.
 */
export function makeManifest(opts: {
  substrateVersion: string;
  instanceSchemaVersion: string;
  namespace: string;
  backend: 'polygraph' | 'neo4j';
  createdAt: string;
  createdBy: string;
  nodeCount: number;
  edgeCount: number;
  auditEventCount: number;
  identityGrantCount: number;
  sigChecksum: string;
}): ManifestV1 {
  return {
    exportSchemaVersion: EXPORT_SCHEMA_VERSION,
    substrateName: SUBSTRATE_NAME,
    substrateVersion: opts.substrateVersion,
    instanceSchemaVersion: opts.instanceSchemaVersion,
    namespace: opts.namespace,
    backend: opts.backend,
    createdAt: opts.createdAt,
    createdBy: opts.createdBy,
    nodeCount: opts.nodeCount,
    edgeCount: opts.edgeCount,
    auditEventCount: opts.auditEventCount,
    identityGrantCount: opts.identityGrantCount,
    sigChecksum: opts.sigChecksum,
  };
}

export async function writeManifest(path: string, manifest: ManifestV1): Promise<void> {
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export async function readManifest(path: string): Promise<ManifestV1> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ManifestV1>;
  return validateManifest(parsed);
}

/**
 * Validate a parsed manifest object against the v1 shape. Throws an
 * informative error if a required field is missing or has the wrong
 * type. Importers should call this before trusting the manifest.
 */
export function validateManifest(obj: Partial<ManifestV1>): ManifestV1 {
  const required: Array<keyof ManifestV1> = [
    'exportSchemaVersion',
    'substrateName',
    'substrateVersion',
    'instanceSchemaVersion',
    'namespace',
    'backend',
    'createdAt',
    'createdBy',
    'nodeCount',
    'edgeCount',
    'auditEventCount',
    'identityGrantCount',
    'sigChecksum',
  ];
  for (const k of required) {
    if (obj[k] === undefined || obj[k] === null) {
      throw new Error(
        `manifest validation: missing required field '${String(k)}'`,
      );
    }
  }
  if (obj.exportSchemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error(
      `manifest validation: unsupported exportSchemaVersion '${obj.exportSchemaVersion}' ` +
        `(this @asi/instance build recognizes '${EXPORT_SCHEMA_VERSION}')`,
    );
  }
  if (obj.substrateName !== SUBSTRATE_NAME) {
    throw new Error(
      `manifest validation: unexpected substrateName '${obj.substrateName}' ` +
        `(expected '${SUBSTRATE_NAME}')`,
    );
  }
  if (obj.backend !== 'polygraph' && obj.backend !== 'neo4j') {
    throw new Error(
      `manifest validation: backend must be 'polygraph' or 'neo4j' (got '${obj.backend}')`,
    );
  }
  return obj as ManifestV1;
}
