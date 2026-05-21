/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase E.
 *
 *   Ownership: asi-local. This subcommand has no upstream solution-intel
 *   counterpart yet; the upstream archetype acquires a `si contracts`
 *   surface on its next refresh once this shape proves itself.
 */

/**
 * `asi contracts list` and `asi contracts show <archetypeName>` — read-side
 * surface for the SIG's loaded archetype contracts.
 *
 * // Why: Contracts loaded by the contract-loader live in PolyGraph; the
 * // CLI needs a queryable surface so operators can confirm what's
 * // anchored to the asi Solution without firing up cypher-shell. This
 * // is the operator-facing manifestation of the SIG+SDD+DSD loop.
 *
 * Exit codes:
 *   0 — success (zero or more contracts found)
 *   1 — `show` did not find a matching contract
 *   2 — connection / usage error
 *
 * @module commands/contracts
 */

import { listContracts, showContract } from '@asi/contract-loader';

/**
 * Options common to both subcommands. `namespace` defaults to "asi" — the
 * operational adoption profile. Tests override.
 */
export interface ContractsCommandOptions {
  namespace?: string;
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  /**
   * Stream to write human-readable output to.
   *
   * // Why: defaulting to `process.stdout` keeps the CLI ergonomic; tests
   * // pass a captured stream so we can assert on output without hijacking
   * // global stdout.
   */
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

const DEFAULT_NAMESPACE = 'asi';

function resolveOptions(options: ContractsCommandOptions): Required<
  Omit<ContractsCommandOptions, 'graphUrl' | 'graphUser' | 'graphPass'>
> & {
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
} {
  return {
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    graphUrl: options.graphUrl,
    graphUser: options.graphUser,
    graphPass: options.graphPass,
  };
}

/**
 * `asi contracts list` — prints a table of contracts anchored to the asi
 * Solution root.
 */
export async function contractsListCommand(
  options: ContractsCommandOptions = {},
): Promise<number> {
  const opts = resolveOptions(options);
  try {
    const entries = await listContracts(opts.namespace, {
      graphUrl: opts.graphUrl,
      graphUser: opts.graphUser,
      graphPass: opts.graphPass,
    });
    if (entries.length === 0) {
      opts.stdout.write(`No contracts loaded in namespace "${opts.namespace}".\n`);
      return 0;
    }
    const header = `${pad('ARCHETYPE', 24)}  ${pad('KIND', 12)}  ${pad('VERSION', 28)}  CONTRACT ID`;
    opts.stdout.write(header + '\n');
    opts.stdout.write('-'.repeat(header.length) + '\n');
    for (const e of entries) {
      opts.stdout.write(
        `${pad(e.archetypeName, 24)}  ${pad(e.archetypeKind, 12)}  ${pad(
          e.archetypeVersion,
          28,
        )}  ${e.contractId}\n`,
      );
    }
    return 0;
  } catch (err) {
    opts.stderr.write(`asi contracts list: ${(err as Error).message}\n`);
    return 2;
  }
}

/**
 * `asi contracts show <archetypeName>` — prints the structured detail
 * for one contract (principles, constraints, services, etc.).
 */
export async function contractsShowCommand(
  archetypeName: string,
  options: ContractsCommandOptions = {},
): Promise<number> {
  const opts = resolveOptions(options);
  if (!archetypeName) {
    opts.stderr.write('asi contracts show: archetype name is required\n');
    return 2;
  }
  try {
    const detail = await showContract(archetypeName, opts.namespace, {
      graphUrl: opts.graphUrl,
      graphUser: opts.graphUser,
      graphPass: opts.graphPass,
    });
    if (!detail) {
      opts.stderr.write(
        `asi contracts show: no contract found for archetype "${archetypeName}" in namespace "${opts.namespace}"\n`,
      );
      return 1;
    }
    const out = opts.stdout;
    out.write(`# Contract: ${detail.archetypeName}\n`);
    out.write(`  kind:        ${detail.archetypeKind}\n`);
    out.write(`  version:     ${detail.archetypeVersion}\n`);
    out.write(`  contractId:  ${detail.contractId}\n`);
    out.write(`  source:      ${detail.sourceBookend}\n`);
    if (detail.composes.length > 0) {
      out.write(`  composes:    ${detail.composes.join(', ')}\n`);
    }
    writeSection(out, 'Principles', detail.principles, (p) => `${p.key}: ${p.name}`);
    writeSection(out, 'Constraints', detail.constraints, (c) => `${c.key}: ${c.name}`);
    writeSection(out, 'Services', detail.services, (s) => `${s.key}: ${s.name}`);
    writeSection(out, 'Processes', detail.processes, (p) => `${p.key}: ${p.name}`);
    writeSection(
      out,
      'DataObjects',
      detail.dataObjects,
      (d) => `${d.key}: ${d.name}`,
    );
    writeSection(out, 'Hypotheses', detail.hypotheses, (h) => `${h.key}: ${h.text}`);
    return 0;
  } catch (err) {
    opts.stderr.write(`asi contracts show: ${(err as Error).message}\n`);
    return 2;
  }
}

function writeSection<T>(
  out: NodeJS.WritableStream,
  label: string,
  items: T[],
  fmt: (item: T) => string,
): void {
  if (items.length === 0) return;
  out.write(`\n## ${label} (${items.length})\n`);
  for (const item of items) {
    out.write(`  - ${fmt(item)}\n`);
  }
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}
