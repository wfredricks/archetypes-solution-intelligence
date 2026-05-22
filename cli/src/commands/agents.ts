/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §D. No upstream solution-intel counterpart
 *   yet; the upstream archetype acquires `agents` on its next refresh
 *   once this shape proves itself.
 *
 *   Ownership: asi-local.
 */

/**
 * `asi agents <name> run` — operator entry point for the read-only
 * agents shipped by `@asi/agents`.
 *
 * // Why: agents are reports, not tool failures. Exit codes:
 * //   0 — agent ran (even with `error`-severity findings)
 * //   1 — connection / usage error
 * //   2 — unknown agent name / missing required flag
 *
 * @module commands/agents
 */

import {
  runCompletenessAgent,
  runBookendAuditAgent,
  formatCompletenessMarkdown,
  formatCompletenessJson,
  formatBookendAuditMarkdown,
  formatBookendAuditJson,
} from '@asi/agents';

const DEFAULT_NAMESPACE = 'asi';

/** Format selector accepted by the run-style commands. */
export type AgentsOutputFormat = 'markdown' | 'json';

/** Options common to every agents subcommand. */
export interface AgentsCommandOptions {
  namespace?: string;
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  format?: AgentsOutputFormat;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

/** Options for `asi agents bookend-audit run`. */
export interface BookendAuditCommandOptions extends AgentsCommandOptions {
  archetype?: string;
  archetypesRepo?: string;
}

function resolveCommon(options: AgentsCommandOptions): {
  namespace: string;
  format: AgentsOutputFormat;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
} {
  return {
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    format: options.format ?? 'markdown',
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    graphUrl: options.graphUrl,
    graphUser: options.graphUser,
    graphPass: options.graphPass,
  };
}

/**
 * `asi agents list` — print the two registered agents and their
 * one-line descriptions. Always exits 0.
 */
export function agentsListCommand(options: AgentsCommandOptions = {}): number {
  const opts = resolveCommon(options);
  opts.stdout.write('Available agents (run with `asi agents <name> run`):\n\n');
  opts.stdout.write('  completeness    Walk the SIG and report gaps in archetype contracts.\n');
  opts.stdout.write('  bookend-audit   Diff a SIG-regenerated right-bookend snapshot against the committed file.\n');
  opts.stdout.write('\nReports are read-only; neither agent writes to the SIG.\n');
  return 0;
}

/**
 * `asi agents completeness run` — run the CompletenessAgent and print
 * its report in the requested format.
 */
export async function completenessRunCommand(
  options: AgentsCommandOptions = {},
): Promise<number> {
  const opts = resolveCommon(options);
  try {
    const report = await runCompletenessAgent({
      namespace: opts.namespace,
      graphUrl: opts.graphUrl,
      graphUser: opts.graphUser,
      graphPass: opts.graphPass,
    });
    opts.stdout.write(
      opts.format === 'json'
        ? formatCompletenessJson(report) + '\n'
        : formatCompletenessMarkdown(report),
    );
    return 0;
  } catch (err) {
    opts.stderr.write(`asi agents completeness run: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * `asi agents bookend-audit run` — run the BookendAuditAgent and print
 * its report. Requires `--archetype` and `--archetypes-repo`.
 */
export async function bookendAuditRunCommand(
  options: BookendAuditCommandOptions = {},
): Promise<number> {
  const opts = resolveCommon(options);
  const archetype = options.archetype;
  const archetypesRepo = options.archetypesRepo;
  if (!archetype) {
    opts.stderr.write('asi agents bookend-audit run: --archetype is required\n');
    return 2;
  }
  if (!archetypesRepo) {
    opts.stderr.write(
      'asi agents bookend-audit run: --archetypes-repo is required (path to a wfredricks/archetypes checkout)\n',
    );
    return 2;
  }
  try {
    const report = await runBookendAuditAgent({
      archetypeName: archetype,
      archetypesRepoPath: archetypesRepo,
      namespace: opts.namespace,
      graphUrl: opts.graphUrl,
      graphUser: opts.graphUser,
      graphPass: opts.graphPass,
    });
    opts.stdout.write(
      opts.format === 'json'
        ? formatBookendAuditJson(report) + '\n'
        : formatBookendAuditMarkdown(report),
    );
    return 0;
  } catch (err) {
    opts.stderr.write(`asi agents bookend-audit run: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * Validates an `--format` value. Returns `null` when the value is
 * unsupported so callers can emit a usage error.
 */
export function parseFormat(raw: string | undefined): AgentsOutputFormat | null {
  if (raw === undefined) return 'markdown';
  if (raw === 'markdown' || raw === 'json') return raw;
  return null;
}
