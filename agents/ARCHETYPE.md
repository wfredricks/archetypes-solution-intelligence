# @asi/agents — provenance + composition notes

*This package is the first non-substrate surface of the solution-intel
archetype. It graduates the archetype from `stub` → `draft`.*

## Provenance

- Originated 2026-05-22 in `archetypes-solution-intelligence` under
  `artifacts/si-runtime/BUILD-PHASE-1B-PLAN.md`.
- Owned by the asi adoption profile. On the next snapshot lift, this
  package becomes
  `archetypes/solution-intel/reference-impl/agents/` with `@adopt:` markers
  added at every customizable identity/composition value (matching the
  identity/cli/graph-client pattern).
- Lift tag (planned, set when this package snapshots into the archetypes
  registry): `solution-intel-reference-impl-agents-2026-05-22`.

## Composition

- **Reads from:** `@asi/contract-loader` query helpers and direct
  `neo4j-driver` sessions against the SIG. No writes.
- **Read by:** `@asi/cli` (`asi agents` command group). The CLI imports
  `runCompletenessAgent` and `runBookendAuditAgent` plus formatters.

## Why "pure-read"?

The SIG is upstream truth; the agents are downstream readers. By refusing
to write, the agents stay safe to run any time, by anyone, without
needing to reason about transaction safety or rollback. Operators who
want a refreshed snapshot run the `snapshot-events-spine.ts`-style script
(or equivalent) explicitly — the agent only reports drift, never repairs
it.

## Adding new agents

A future agent should follow the same shape:

1. Live in `src/<agent-slug>/`.
2. Export a `run<Name>Agent(opts)` function returning `AgentReport`.
3. Ship a `format.ts` with `formatMarkdown` + `formatJson`.
4. Stay read-only on the SIG.
5. Get wired into `cli/src/commands/agents.ts` with a new subcommand.

🖇️ *Two agents, one package. Observers, not mutators.*
