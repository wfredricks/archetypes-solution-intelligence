# scripts/

Adoption-level scripts that operate on the live ASI substrate. All
scripts default to `bolt://localhost:7689` with the constellation-neo4j
credentials (see `TOOLS.md`); override via the `ASI_GRAPH_*` environment
variables shown for `seed-solution.ts` below.

| Script | Reads | Writes | Idempotent |
|---|---|---|---|
| `seed-solution.ts`                        | —                     | `:Solution {namespace: "asi"}`              | Yes (clears + reseeds) |
| `load-contracts.ts`                       | LEFT-BOOKEND.md files | `:Contract` + sub-nodes via `@asi/contract-loader` | Yes (per `commitContract`) |
| `verify-graph.ts`                         | SIG                   | —                                          | Yes (read-only) |
| `query-events-spine.ts`                   | SIG                   | —                                          | Yes (read-only) |
| `snapshot-events-spine.ts`                | SIG                   | — (markdown to stdout)                     | Yes (deterministic) |
| `writeback-events-spine-hypotheses.ts`    | SIG                   | H1–H5 status + evidence + verifiedAt        | Yes (advances verifiedAt) |
| `writeback-events-spine-stage-2d.ts`      | SIG                   | H6 + H7 status + evidence + verifiedAt      | Yes (advances verifiedAt) |

## `seed-solution.ts`

Seeds the asi adoption's Solution Intelligence Graph (SIG) root node in PolyGraph.

```bash
# Default (assumes constellation-neo4j is up on bolt://localhost:7689):
npx tsx scripts/seed-solution.ts

# Custom Bolt URL / auth:
ASI_GRAPH_URL=bolt://host:port \
  ASI_GRAPH_USER=neo4j ASI_GRAPH_PASS=secret \
  npx tsx scripts/seed-solution.ts
```

**Idempotent.** Re-running clears any prior `adoptionId: "asi"` nodes and reseeds. Other namespaces are untouched.

**What it creates:** exactly one node:

```cypher
(s:Solution {
  name: "Archetypes",
  title: "Archetypes Solution Intel",
  namespace: "asi",
  adoptionId: "asi",
  adoptedAt: datetime("2026-05-21T13:42:00-04:00"),
  adoptionVersion: "solution-intel@solution-intel-reference-impl-2026-05-21",
  composes_identity: "simple-auth",
  composes_auditLedger: "simple-ledger",
  composes_eventing: "events-spine",
  composes_graph: "graph-db",
  cliBinary: "asi",
  apiPrefix: "/asi",
  identityHttpPort: 3101,
  envVarPrefix: "ASI",
  defaultConfigPath: "~/.asi/",
  packageScope: "@asi"
})
```

This Solution node is the anchor every subsequent contract in the asi SIG attaches to. Task 3 (load archetype contracts into the SIG) hangs new subgraphs off this root.

## `load-contracts.ts`

Loads archetype contracts (LEFT-BOOKEND.md → SIG) via the
`@asi/contract-loader` package. Currently loads `events-spine` and
`simple-auth`; extend as new archetypes graduate.

```bash
npx tsx scripts/load-contracts.ts
```

**Idempotent.** Each contract is committed with `contractId + namespace`
scope; re-running re-creates the same sub-graph.

## `verify-graph.ts`

Read-only spot-check over the asi SIG. Prints the Solution root
properties and a count of anchored Contracts. Use after `seed-solution`
or `load-contracts` to confirm the namespace is wired correctly.

```bash
npx tsx scripts/verify-graph.ts
```

## `query-events-spine.ts`

Read-only inspector for the events-spine contract + hypothesis state in
the asi SIG. Dumps the Contract envelope and every sub-node
(Principles / Constraints / Services / Processes / DataObjects /
Hypotheses) as JSON to stdout. Prefer this over cypher-shell for
spot-checks during writeback runs.

```bash
npx tsx scripts/query-events-spine.ts
```

**Read-only.** Safe to re-run.

## `snapshot-events-spine.ts`

Regenerates the events-spine RIGHT-BOOKEND snapshot from the current SIG
state. Produces a markdown hypothesis table on stdout suitable for
committing as
`archetypes/events-spine/RIGHT-BOOKEND-snapshot-<YYYY-MM-DD>.md`.

```bash
npx tsx scripts/snapshot-events-spine.ts \
  > ../archetypes/events-spine/RIGHT-BOOKEND-snapshot-$(date +%Y-%m-%d).md
```

**Read-only.** The SIG is upstream truth; the snapshot file is downstream
evidence regenerated from the SIG, not hand-edited.

## `writeback-events-spine-hypotheses.ts`

Sets hypothesis status + evidence + `verifiedAt` on H1–H5 of the
events-spine contract in the asi SIG. H1–H5 are the
reference-impl-internal hypotheses verified by the events-spine build
itself; invoked at the end of the events-spine reference-impl build
(Phase N½ of the BUILD-RECIPE).

```bash
npx tsx scripts/writeback-events-spine-hypotheses.ts
```

**Idempotent.** Re-running SETs the same status + evidence; `verifiedAt`
advances to `now()` on every run by design — the timestamp records when
verification was last asserted, not when the hypothesis first flipped.

## `writeback-events-spine-stage-2d.ts`

Sets H6 + H7 of the events-spine contract from `untested` to their
post-adoption status with evidence drawn from Stage 2d (SI/I adoption).
Companion to `writeback-events-spine-hypotheses.ts`; touches **only**
H6 + H7 (H1–H5 untouched).

```bash
npx tsx scripts/writeback-events-spine-stage-2d.ts
```

**Idempotent** in the same way as the H1–H5 writeback. Splitting the two
writebacks keeps the provenance of each evidence string unambiguous
(archetype-internal vs. adopter-derived).
