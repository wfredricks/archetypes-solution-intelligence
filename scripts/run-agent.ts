/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §F (live validation harness).
 *
 *   Ownership: asi-local.
 */

/**
 * Tiny wrapper around `@asi/agents` for ad-hoc CLI-free runs.
 *
 * // Why: the recipe's Phase F also accepts running via `asi agents` from
 * // the cli binary. This script exists as a tsx-driven alternative for
 * // running against the live SIG without building dist/.
 *
 * Usage:
 *   npx tsx scripts/run-agent.ts completeness
 *   npx tsx scripts/run-agent.ts bookend-audit --archetype events-spine \
 *     --archetypes-repo /path/to/archetypes
 */

import {
  runCompletenessAgent,
  runBookendAuditAgent,
  formatCompletenessMarkdown,
  formatBookendAuditMarkdown,
} from '../agents/src/index.js';

async function main(): Promise<void> {
  const [, , agentName, ...rest] = process.argv;
  const opts = parseFlags(rest);
  if (agentName === 'completeness') {
    const report = await runCompletenessAgent({
      namespace: opts.namespace,
      graphUrl: opts.graphUrl,
      graphUser: opts.graphUser,
      graphPass: opts.graphPass,
    });
    process.stdout.write(formatCompletenessMarkdown(report));
    return;
  }
  if (agentName === 'bookend-audit') {
    if (!opts.archetype || !opts.archetypesRepo) {
      process.stderr.write(
        'run-agent: bookend-audit requires --archetype and --archetypes-repo\n',
      );
      process.exit(2);
    }
    const report = await runBookendAuditAgent({
      archetypeName: opts.archetype,
      archetypesRepoPath: opts.archetypesRepo,
      namespace: opts.namespace,
      graphUrl: opts.graphUrl,
      graphUser: opts.graphUser,
      graphPass: opts.graphPass,
    });
    process.stdout.write(formatBookendAuditMarkdown(report));
    return;
  }
  process.stderr.write(`run-agent: unknown agent "${agentName ?? ''}"\n`);
  process.exit(2);
}

interface Flags {
  namespace?: string;
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  archetype?: string;
  archetypesRepo?: string;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {
    namespace: process.env.ASI_NAMESPACE ?? 'asi',
    graphUrl: process.env.ASI_GRAPH_URL,
    graphUser: process.env.ASI_GRAPH_USER,
    graphPass: process.env.ASI_GRAPH_PASS,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--namespace':
        out.namespace = value;
        i++;
        break;
      case '--graph-url':
        out.graphUrl = value;
        i++;
        break;
      case '--archetype':
        out.archetype = value;
        i++;
        break;
      case '--archetypes-repo':
        out.archetypesRepo = value;
        i++;
        break;
      default:
        break;
    }
  }
  return out;
}

main().catch((err) => {
  process.stderr.write(`run-agent: ${(err as Error).message}\n`);
  process.exit(1);
});
