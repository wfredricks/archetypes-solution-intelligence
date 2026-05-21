# Archetypes Solution Intel

*First adoption of the [`solution-intel`](https://github.com/wfredricks/archetypes/tree/main/solution-intel) archetype. Hosts the [archetypes registry's](https://github.com/wfredricks/archetypes) own Solution Intelligence Graph (SIG).*

🖇️ Adoption profile: **asi** (Archetypes Solution Intel)

---

## What this is

This repository is the first end-to-end adoption of the `solution-intel` composite archetype. Its purpose is to give the archetypes registry itself a Solution Intelligence substrate to host its own SIG. Every other archetype in the registry will eventually express its contracts as nodes in this SIG.

The substrate composes:

- **identity** (`@asi/identity`) — passwordless email-and-code auth + 5-role grant ledger (derived from `simple-auth`)
- **cli** (`@asi/cli`) — the `asi` command-line interface
- **graph-client** (`@asi/graph-client`) — typed HTTP client for the SIG store
- **graph-db** — PolyGraph (Neo4j) at `bolt://localhost:7689` hosting the SIG

Composition seams identified by `@adopt:composes:*` markers in the source. Stage 2d will wire in `events-spine`; the marker is a documented placeholder until then.

## Quick start

```bash
# 1. Install
cd identity      && npm install && npm run build
cd ../cli        && npm install && npm run build
cd ../graph-client && npm install && npm run build

# 2. Seed the SIG (creates one Solution root node in PolyGraph)
npx tsx scripts/seed-solution.ts

# 3. Boot identity (defaults to :3101)
cd identity && node dist/server.js

# 4. Use the asi CLI
./cli/bin/asi --help
./cli/bin/asi login --url http://localhost:3101
```

## Solution root

The substrate's SIG is anchored by a single `Solution` node in PolyGraph:

```cypher
MATCH (s:Solution {namespace: "asi"}) RETURN s
```

Properties:

| key | value |
|---|---|
| name | `Archetypes` |
| title | `Archetypes Solution Intel` |
| namespace | `asi` |
| cliBinary | `asi` |
| apiPrefix | `/asi` |
| identityHttpPort | `3101` |
| adoptionVersion | `solution-intel@solution-intel-reference-impl-2026-05-21` |

Every subsequent contract loaded into this SIG anchors to this node.

## Adoption details

- **Source archetype:** [`archetypes/solution-intel`](https://github.com/wfredricks/archetypes/tree/main/solution-intel)
- **Source commit/tag:** `solution-intel-reference-impl-2026-05-21`
- **Adopted at:** 2026-05-21
- **Methodology:** [`archetypes/METHODOLOGY.md`](https://github.com/wfredricks/archetypes/blob/main/METHODOLOGY.md)
- **Adoption findings:** [`ADOPTION-FINDINGS.md`](./ADOPTION-FINDINGS.md)
- **Refresh policy:** Position B — refresh-on-demand. Upstream changes flow into this adoption only when an explicit refresh task is run.

## Cross-references

- **Archetypes registry:** <https://github.com/wfredricks/archetypes>
- **solution-intel archetype:** <https://github.com/wfredricks/archetypes/tree/main/solution-intel>
- **DSD-PRFAQ:** <https://github.com/wfredricks/archetypes/blob/main/docs/DSD-PRFAQ.md>

---

*🖇️ The substrate hosting the registry that contains the substrate's archetype description. The recursive moment.*
