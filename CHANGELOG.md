# Changelog

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
