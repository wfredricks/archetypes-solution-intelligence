/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.6.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"What the contract requires the
 *   substrate to grow" — surfaces #1 and #2 (`si instance export` and
 *   `si instance import`) routed through @asi/instance.
 *
 *   Ownership: asi-local.
 */

/**
 * `asi instance export` and `asi instance import` — operator entry
 * points for the whole-instance snapshot contract.
 *
 * The CLI is thin: it normalizes options, calls @asi/instance, and
 * surfaces results / errors.
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime error (e.g. cannot open backend, malformed export)
 *   2 — usage error (missing required option, unrecognized format)
 *
 * @module commands/instance
 */

import { exportInstance, importInstance } from '@asi/instance';

const DEFAULT_NAMESPACE = 'asi';
const DEFAULT_BACKEND: 'polygraph' | 'neo4j' = 'neo4j';

/** Options common to both subcommands. */
export interface InstanceCommandCommonOptions {
  namespace?: string;
  backend?: string;
  polygraphPath?: string;
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  auditPath?: string;
  grantsPath?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface InstanceExportCommandOptions extends InstanceCommandCommonOptions {
  output?: string;
  resolvedMarkersPath?: string;
  substrateVersion?: string;
  instanceSchemaVersion?: string;
}

export interface InstanceImportCommandOptions extends InstanceCommandCommonOptions {
  input?: string;
  force?: boolean;
  substrateVersion?: string;
}

const DEFAULT_SUBSTRATE_VERSION = '0.2.0-pre';
const DEFAULT_INSTANCE_SCHEMA_VERSION = '0.2.0-pre';

function resolveBackend(s: string | undefined): 'polygraph' | 'neo4j' | null {
  if (s === undefined) return DEFAULT_BACKEND;
  if (s === 'polygraph' || s === 'neo4j') return s;
  return null;
}

/**
 * `asi instance export` — produce a tarball snapshot of the running
 * instance and write it to --output.
 */
export async function instanceExportCommand(
  options: InstanceExportCommandOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const backend = resolveBackend(options.backend);
  if (backend === null) {
    stderr.write(`asi instance export: unknown --backend "${options.backend}" (expected polygraph|neo4j)\n`);
    return 2;
  }
  if (!options.output) {
    stderr.write('asi instance export: --output is required\n');
    return 2;
  }
  if (backend === 'polygraph' && !options.polygraphPath) {
    stderr.write('asi instance export: --polygraph-path is required when --backend polygraph\n');
    return 2;
  }
  if (backend === 'neo4j' && !options.graphUrl) {
    stderr.write('asi instance export: --graph-url is required when --backend neo4j\n');
    return 2;
  }

  try {
    const result = await exportInstance({
      output: options.output,
      namespace,
      backend,
      polygraphPath: options.polygraphPath,
      graphUrl: options.graphUrl,
      graphUser: options.graphUser,
      graphPass: options.graphPass,
      auditPath: options.auditPath,
      grantsPath: options.grantsPath,
      resolvedMarkersPath: options.resolvedMarkersPath,
      substrateVersion: options.substrateVersion ?? DEFAULT_SUBSTRATE_VERSION,
      instanceSchemaVersion:
        options.instanceSchemaVersion ?? DEFAULT_INSTANCE_SCHEMA_VERSION,
      createdBy: 'asi instance export',
    });
    stdout.write(`asi instance export: wrote ${result.outputPath}\n`);
    stdout.write(`  nodes:     ${result.manifest.nodeCount}\n`);
    stdout.write(`  edges:     ${result.manifest.edgeCount}\n`);
    stdout.write(`  audit:     ${result.manifest.auditEventCount}\n`);
    stdout.write(`  grants:    ${result.manifest.identityGrantCount}\n`);
    stdout.write(`  backend:   ${result.manifest.backend}\n`);
    stdout.write(`  namespace: ${result.manifest.namespace}\n`);
    stdout.write(`  checksum:  ${result.manifest.sigChecksum}\n`);
    return 0;
  } catch (err) {
    stderr.write(`asi instance export: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * `asi instance import <input>` — restore the SIG, audit ledger, and
 * identity records from a tarball.
 */
export async function instanceImportCommand(
  options: InstanceImportCommandOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const backend = resolveBackend(options.backend);
  if (backend === null) {
    stderr.write(`asi instance import: unknown --backend "${options.backend}" (expected polygraph|neo4j)\n`);
    return 2;
  }
  if (!options.input) {
    stderr.write('asi instance import: --input is required\n');
    return 2;
  }
  if (backend === 'polygraph' && !options.polygraphPath) {
    stderr.write('asi instance import: --polygraph-path is required when --backend polygraph\n');
    return 2;
  }
  if (backend === 'neo4j' && !options.graphUrl) {
    stderr.write('asi instance import: --graph-url is required when --backend neo4j\n');
    return 2;
  }

  try {
    const result = await importInstance({
      input: options.input,
      namespace,
      backend,
      polygraphPath: options.polygraphPath,
      graphUrl: options.graphUrl,
      graphUser: options.graphUser,
      graphPass: options.graphPass,
      auditPath: options.auditPath,
      grantsPath: options.grantsPath,
      substrateVersion: options.substrateVersion ?? DEFAULT_SUBSTRATE_VERSION,
      force: options.force ?? false,
      performedBy: 'asi instance import',
    });
    stdout.write(`asi instance import: ${options.input} → ${namespace}\n`);
    stdout.write(`  nodes imported:        ${result.nodesImported}\n`);
    stdout.write(`  edges imported:        ${result.edgesImported}\n`);
    stdout.write(`  audit events appended: ${result.auditEventsAppended}\n`);
    stdout.write(`  grants appended:       ${result.identityGrantsAppended}\n`);
    stdout.write(`  migrations applied:    ${result.migrationsApplied}\n`);
    if (result.warnings.length > 0) {
      stdout.write(`  warnings:              ${result.warnings.length}\n`);
      for (const w of result.warnings) {
        stdout.write(`    - ${w}\n`);
      }
    }
    return 0;
  } catch (err) {
    stderr.write(`asi instance import: ${(err as Error).message}\n`);
    return 1;
  }
}
