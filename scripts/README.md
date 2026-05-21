# scripts/

Adoption-level scripts that operate on the live ASI substrate.

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
