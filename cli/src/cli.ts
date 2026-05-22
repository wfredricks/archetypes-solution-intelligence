#!/usr/bin/env node
/**
 * Derived from archetypes/solution-intel/reference-impl/cli/src/cli.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - @adopt:cli-binary-name ANSWERED → `asi`
 *   - program.name('si') → program.name('asi')
 *   - Description 'Solution Intelligence CLI' → 'Archetypes Solution Intel CLI'
 *   - Error/usage strings `si grant:` / `si revoke:` → `asi grant:` /
 *     `asi revoke:`
 *   - --url help mentions ASI_URL (was SI_URL)
 *   - Error prefix `si: ${err.message}` → `asi: ${err.message}`
 *   - Added `asi agents` command group (Phase 1b, 2026-05-22): list,
 *     completeness run, bookend-audit run; no upstream counterpart yet.
 */

/**
 * `asi` command-line entry point.
 *
 * // Why: This is the bin shim wired up by package.json#bin. We use
 * // `commander` for argument parsing because it gives us subcommands,
 * // positional + flag-style arguments in the same definition (Decision
 * // B3), and a free `--help` / `--version` surface. Each subcommand
 * // dispatches to a function in `src/commands/` that returns an exit
 * // code; the action handler `process.exit`s with that code so commander
 * // doesn't keep the event loop alive.
 *
 * @module cli
 */

import { Command } from 'commander';
import { pathToFileURL } from 'node:url';

import { VERSION } from './version.js';
import { loginCommand } from './commands/login.js';
import { grantCommand } from './commands/grant.js';
import { revokeCommand } from './commands/revoke.js';
import {
  contractsListCommand,
  contractsShowCommand,
} from './commands/contracts.js';
import {
  agentsListCommand,
  completenessRunCommand,
  bookendAuditRunCommand,
  parseFormat,
} from './commands/agents.js';

const program = new Command();

// @adopt:cli-binary-name
// Q: What's the command-line tool's invocation name?
//    Wired into package.json#bin (the bin shim symlink) and into the
//    Commander program name (used in help text and error prefixes).
//    Keep aligned with @adopt:namespace in identity/src/index.ts.
// Default: si
// ANSWER:  asi (matches @adopt:namespace = asi)
// Format: [a-z][a-z0-9-]{1,15}
program
  .name('asi')
  .description('Archetypes Solution Intel CLI')
  .version(VERSION, '-v, --version');

// ─── login ───────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with an ASI/I identity service via email and access code')
  .option('--url <url>', 'ASI/I base URL (overrides ASI_URL env and project config)')
  .option('--email <email>', 'Email address (skip the email prompt)')
  .action(async (options: { url?: string; email?: string }) => {
    process.exit(
      await loginCommand({
        url: options.url,
        emailOverride: options.email,
      }),
    );
  });

// ─── grant ───────────────────────────────────────────────────────────────────

program
  .command('grant [project] [user] [role]')
  .description('Grant a role to a user on a project (Owner only)')
  .option('--url <url>', 'SI/I base URL')
  .option('--project <project>', 'Project id')
  .option('--user <user>', 'Target user id (typically an email)')
  .option('--role <role>', 'Role: Owner | Operator | Analyst | Reviewer | Customer')
  .action(
    async (
      project: string | undefined,
      user: string | undefined,
      role: string | undefined,
      options: { url?: string; project?: string; user?: string; role?: string },
    ) => {
      // Why: Per Decision B3, both positional and flag forms are accepted.
      // Per the plan, when both are present the FLAG wins (explicit beats
      // implicit). When neither is present we error with usage guidance.
      const merged = {
        url: options.url,
        project: options.project ?? project,
        user: options.user ?? user,
        role: options.role ?? role,
      };
      if (!merged.project || !merged.user || !merged.role) {
        process.stderr.write(
          'asi grant: --project, --user, and --role are required (or pass as positional args)\n',
        );
        process.exit(2);
      }
      process.exit(
        await grantCommand({
          url: merged.url,
          project: merged.project,
          user: merged.user,
          role: merged.role,
        }),
      );
    },
  );

// ─── revoke ──────────────────────────────────────────────────────────────────

program
  .command('revoke [project] [grantId]')
  .description('Revoke a previously-granted role (Owner only)')
  .option('--url <url>', 'SI/I base URL')
  .option('--project <project>', 'Project id')
  .option('--grant <grantId>', 'Grant id to revoke')
  .action(
    async (
      project: string | undefined,
      grantId: string | undefined,
      options: { url?: string; project?: string; grant?: string },
    ) => {
      const merged = {
        url: options.url,
        project: options.project ?? project,
        grantId: options.grant ?? grantId,
      };
      if (!merged.project || !merged.grantId) {
        process.stderr.write(
          'asi revoke: --project and --grant are required (or pass as positional args)\n',
        );
        process.exit(2);
      }
      process.exit(
        await revokeCommand({
          url: merged.url,
          project: merged.project,
          grantId: merged.grantId,
        }),
      );
    },
  );

// ─── contracts ───────────────────────────────────────────────────────

// Why: contracts is the read-side surface for the SIG ontology that Task 3
//       loaded into PolyGraph. Two subcommands: `list` and `show`.
//       The substrate they query is the asi Solution root + HAS_CONTRACT
//       edges established by @asi/contract-loader.

const contracts = program
  .command('contracts')
  .description('Inspect archetype contracts loaded into the asi SIG');

contracts
  .command('list')
  .description('List archetype contracts anchored to the asi Solution root')
  .option('--namespace <ns>', 'Solution namespace to query', 'asi')
  .option('--graph-url <url>', 'Bolt URL (defaults to bolt://localhost:7689 or ASI_GRAPH_URL)')
  .action(async (options: { namespace?: string; graphUrl?: string }) => {
    process.exit(
      await contractsListCommand({
        namespace: options.namespace,
        graphUrl: options.graphUrl ?? process.env.ASI_GRAPH_URL,
        graphUser: process.env.ASI_GRAPH_USER,
        graphPass: process.env.ASI_GRAPH_PASS,
      }),
    );
  });

contracts
  .command('show <archetype>')
  .description('Show the structured detail of one archetype contract')
  .option('--namespace <ns>', 'Solution namespace to query', 'asi')
  .option('--graph-url <url>', 'Bolt URL (defaults to bolt://localhost:7689 or ASI_GRAPH_URL)')
  .action(
    async (
      archetype: string,
      options: { namespace?: string; graphUrl?: string },
    ) => {
      process.exit(
        await contractsShowCommand(archetype, {
          namespace: options.namespace,
          graphUrl: options.graphUrl ?? process.env.ASI_GRAPH_URL,
          graphUser: process.env.ASI_GRAPH_USER,
          graphPass: process.env.ASI_GRAPH_PASS,
        }),
      );
    },
  );

// ─── agents ──────────────────────────────────────────────────────────

// Why: agents is the read-only reports surface. Two agents shipped at
//       v0.1.0-pre: completeness (SIG walker) and bookend-audit (SIG
//       vs committed-snapshot diff). The CLI exposes `list` plus
//       `<name> run` subcommands; reports are reports, so a finding of
//       severity=error does NOT make the command fail (exit 0 still).
//       Exit 1 = connection error; exit 2 = bad flag.

const agents = program
  .command('agents')
  .description('Read-only agents that walk the asi SIG and emit reports');

agents
  .command('list')
  .description('List available agents')
  .action(() => {
    process.exit(agentsListCommand());
  });

const completeness = agents
  .command('completeness')
  .description('CompletenessAgent — surface gaps in archetype contracts (read-only)');

completeness
  .command('run')
  .description('Run the CompletenessAgent and print its report')
  .option('--namespace <ns>', 'Solution namespace to query', 'asi')
  .option('--graph-url <url>', 'Bolt URL (defaults to bolt://localhost:7689 or ASI_GRAPH_URL)')
  .option('--format <fmt>', 'Output format: markdown | json', 'markdown')
  .action(
    async (options: { namespace?: string; graphUrl?: string; format?: string }) => {
      const format = parseFormat(options.format);
      if (format === null) {
        process.stderr.write(
          `asi agents completeness run: unknown --format "${options.format}" (expected markdown|json)\n`,
        );
        process.exit(2);
      }
      process.exit(
        await completenessRunCommand({
          namespace: options.namespace,
          graphUrl: options.graphUrl ?? process.env.ASI_GRAPH_URL,
          graphUser: process.env.ASI_GRAPH_USER,
          graphPass: process.env.ASI_GRAPH_PASS,
          format,
        }),
      );
    },
  );

const bookendAudit = agents
  .command('bookend-audit')
  .description('BookendAuditAgent — diff a SIG-regenerated snapshot against the committed file');

bookendAudit
  .command('run')
  .description('Run the BookendAuditAgent for one archetype and print its report')
  .option('--archetype <name>', 'Archetype to audit (e.g. events-spine)')
  .option(
    '--archetypes-repo <path>',
    'Path to a wfredricks/archetypes checkout',
  )
  .option('--namespace <ns>', 'Solution namespace to query', 'asi')
  .option('--graph-url <url>', 'Bolt URL (defaults to bolt://localhost:7689 or ASI_GRAPH_URL)')
  .option('--format <fmt>', 'Output format: markdown | json', 'markdown')
  .action(
    async (options: {
      archetype?: string;
      archetypesRepo?: string;
      namespace?: string;
      graphUrl?: string;
      format?: string;
    }) => {
      const format = parseFormat(options.format);
      if (format === null) {
        process.stderr.write(
          `asi agents bookend-audit run: unknown --format "${options.format}" (expected markdown|json)\n`,
        );
        process.exit(2);
      }
      process.exit(
        await bookendAuditRunCommand({
          archetype: options.archetype,
          archetypesRepo: options.archetypesRepo,
          namespace: options.namespace,
          graphUrl: options.graphUrl ?? process.env.ASI_GRAPH_URL,
          graphUser: process.env.ASI_GRAPH_USER,
          graphPass: process.env.ASI_GRAPH_PASS,
          format,
        }),
      );
    },
  );

// ─── Bin entry ───────────────────────────────────────────────────────────────

// Why: We only invoke commander's parser when this file is the process
// entry point. Tests import `program` directly and drive it programmatically
// without firing the parser at module-load time. The `pathToFileURL` dance
// avoids mismatches on macOS volume paths containing spaces or unicode.
function isCliEntry(): boolean {
  if (typeof process === 'undefined') return false;
  if (!Array.isArray(process.argv) || typeof process.argv[1] !== 'string') {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  program.parseAsync(process.argv).catch((err: Error) => {
    process.stderr.write(`asi: ${err.message}\n`);
    process.exit(2);
  });
}

export { program };
