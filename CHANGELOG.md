# Changelog

## [Unreleased]

**Phase 1a polish batch.** Cross-cutting low-hanging fruit from Stages 2a–2d FINDINGS. See [`artifacts/si-runtime/BUILD-PHASE-1A-PLAN.md`](../si-runtime/BUILD-PHASE-1A-PLAN.md) and the Phase 1a FINDINGS file.

### Changed

- **`@asi/contract-loader`**: surface `Hypothesis.verifiedAt` (`string | null`) in `types.ts`, `parseBookend()`, `commitContract()`, and `showContract()`. Parsed bookend hypotheses default to `null`; writeback scripts populate the ISO timestamp. **F1.a**.
- **`@asi/cli`**: `asi contracts show` renders `h.status` and `h.verifiedAt` inline. Each hypothesis row now reads `Hn: [status] text [verified=<ISO>]`. Operators no longer need cypher to confirm Stage 2d's H6+H7 writeback. **F1.b**.

## 0.1.1-pre — 2026-05-21

**Contract ontology realized in PolyGraph; events-spine and simple-auth contracts loaded.**

Task 3 of the SIG-first pivot ([`BUILD-TASK-3-SIG-CONTRACTS-PLAN.md`](../archetypes-bootstrap/BUILD-TASK-3-SIG-CONTRACTS-PLAN.md)) closed the SIG+SDD+DSD loop. Before this release, the asi SIG held exactly one node (the Solution root from v0.1.0-pre). It now holds two anchored archetype contracts with their full sub-node graphs.

### New: `@asi/contract-loader`

A TypeScript module that parses `LEFT-BOOKEND.md` files into in-memory `ContractGraph` payloads and commits them to PolyGraph anchored to the asi Solution root. See [`contract-loader/README.md`](./contract-loader/README.md) for the expected bookend shape and the Cypher schema it writes.

- **`parseBookend(filePath)`** — markdown→graph, tolerant of section numbering / parenthetical suffixes. Reads optional YAML front-matter for stable contract identity (`archetypeName`, `archetypeKind`, `archetypeVersion`).
- **`commitContract(graph, { namespace })`** — idempotent commit; clears the prior subgraph by `contractId + namespace` before re-creating. Refuses to write if no `Solution` root exists for the namespace (no orphan nodes possible).
- **`listContracts(namespace)`** / **`showContract(name, namespace)`** — read-side helpers, used by the new CLI subcommand.
- Tests: 21/21 — 9 parse-events-spine + 9 parse-simple-auth + 3 commit-contract round-trip (live PolyGraph, scoped namespace).

### New: `asi contracts` subcommand

- **`asi contracts list`** — prints the archetype contracts anchored to the asi Solution root.
- **`asi contracts show <archetypeName>`** — prints the structured detail (Principles / Constraints / Services / Processes / DataObjects / Hypotheses / Compositions).
- Tests: 4 new tests in `cli/tests/contracts.test.ts` (63/63 cli total).

### Loaded contracts

Both canonical bookends are loaded into the operational asi namespace:

| Archetype | Kind | Version | Nodes | Edges |
|---|---|---|---|---|
| `events-spine` | composite | `v0.1.0-pre` | 28 | 28 |
| `simple-auth` | primitive | `lifted-2026-05-20` | 27 | 27 |

Total SIG growth: **+55 nodes, +55 edges** anchored to the Archetypes Solution root.

### Cypher smoke test

```cypher
MATCH (s:Solution {namespace: "asi"})-[:HAS_CONTRACT]->(c:Contract)
RETURN c.archetypeName, c.archetypeKind, count{(c)-[]->()} AS subEdges
ORDER BY c.archetypeName
```

Returns two rows: `events-spine` (composite, 27 sub-edges) and `simple-auth` (primitive, 26 sub-edges).

### Bookend convention added: YAML front-matter

`archetypes/events-spine/LEFT-BOOKEND.md` and `archetypes/simple-auth/LEFT-BOOKEND.md` gained a 3-key YAML front-matter block declaring `archetypeName`, `archetypeKind`, and `archetypeVersion`. Documented in [`contract-loader/README.md`](./contract-loader/README.md). Future LEFT-BOOKENDs follow the same convention so identity is explicit rather than inferred.

`simple-auth/LEFT-BOOKEND.md`'s Services and DataObjects sections were also reshaped from bullet-form to `### S<n>:` / `### DO<n>:` item-form to match the canonical events-spine bookend shape. No semantic changes — the same six services and four data objects, named the same way; the parser can now read them cleanly.

### Tests

| Subpackage | Tests | Status |
|---|---|---|
| `identity/` | 70/70 | ✅ |
| `cli/` | 63/63 | ✅ (was 59; +4 contracts CLI tests) |
| `graph-client/` | 1/1 | ✅ |
| `contract-loader/` | 21/21 | ✅ (new) |
| **Total** | **155/155** | ✅ |

## 0.1.0-pre — 2026-05-21

**First adoption of the `solution-intel` archetype.**

This is the substrate-level adoption that hosts the archetypes registry's own Solution Intelligence Graph (SIG). The recursive moment: the registry contains an archetype whose adoption hosts the registry's own contracts.

### Derived from upstream

- `identity/` from `archetypes/solution-intel/reference-impl/identity/`
- `cli/` from `archetypes/solution-intel/reference-impl/cli/`
- `graph-client/` from `archetypes/solution-intel/reference-impl/graph-client/`

All three carry provenance JSDoc headers per `archetypes/METHODOLOGY.md §Marking conventions`.

Source tag pinned: `solution-intel-reference-impl-2026-05-21`.

### Adoption profile (`asi`)

| Marker | Value |
|---|---|
| `@adopt:namespace` | `asi` |
| `@adopt:solution-name` | `Archetypes` |
| `@adopt:title` | `Archetypes Solution Intel` |
| `@adopt:cli-binary` | `asi` |
| `@adopt:api-prefix` | `/asi` |
| `@adopt:default-port:identity-http` | `3101` (offset from upstream 3001) |
| `@adopt:env-var-prefix` | `ASI_` |
| `@adopt:default-config-path` | `~/.asi/` |
| `@adopt:package-scope` | `@asi` |
| `@adopt:project-id` | `asi-default` |
| `@adopt:audit-log-path` | `<cwd>/data/chainblocks/asi.audit.jsonl` |
| `@adopt:grants-ledger-path` | `<cwd>/data/identity/grants.jsonl` |
| `@adopt:event-subject-prefix` | `asi` (events `asi.role.granted`, `asi.role.revoked`) |
| `@adopt:credentials-dir` | `~/.asi` |
| `@adopt:default-endpoint-env-var` | `ASI_URL` |
| `@adopt:project-config-path` | `.asi/config.yaml` |
| `@adopt:graph-url` | `bolt://localhost:7689` |
| `@adopt:composes:identity` | `simple-auth` (default) |
| `@adopt:composes:audit-ledger` | `simple-ledger` (default) |
| `@adopt:composes:eventing` | `events-spine` (placeholder; archetype not yet authored) |
| `@adopt:composes:graph` | `graph-db` (PolyGraph/Neo4j) |

### What runs

- **`@asi/identity`** — HTTP identity service. Boots on `:3101`. `/health` returns `{"ok": true, "service": "asi-identity", "version": "0.1.0-pre"}`. 70/70 tests pass.
- **`@asi/cli`** — `asi` command-line tool. `asi --help`, `asi login`, `asi grant`, `asi revoke`. 59/59 tests pass.
- **`@asi/graph-client`** — scaffold; PolyGraph access goes direct via `neo4j-driver` for now. 1/1 test pass.
- **`scripts/seed-solution.ts`** — idempotent seed of the asi SIG root in PolyGraph.
- **`scripts/verify-graph.ts`** — round-trip read of the Solution root.

### SIG state in PolyGraph

```cypher
MATCH (s:Solution {namespace: "asi"}) RETURN s
```

Returns exactly one node with the full `asi` adoption profile encoded as properties. Anchored at `bolt://localhost:7689`. This node is the load-bearing anchor every subsequent contract loaded into the asi SIG (Task 3 onward) attaches to.
