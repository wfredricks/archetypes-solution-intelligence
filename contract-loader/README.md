# @asi/contract-loader

Parses `LEFT-BOOKEND.md` files into in-memory **contract graphs** and commits them to **PolyGraph** anchored to the asi Solution root.

This module is the bridge between markdown bookends (the canonical pre-build contract form per [`METHODOLOGY.md`](../../archetypes/METHODOLOGY.md) §Bookends) and graph contracts (the form the SIG+SDD+DSD loop operates on).

It was built for Task 3 of the SIG-first pivot ([`BUILD-TASK-3-SIG-CONTRACTS-PLAN.md`](../../archetypes-bootstrap/BUILD-TASK-3-SIG-CONTRACTS-PLAN.md), 2026-05-21) and realizes in code the ArchiMate-flavored SIG ontology proposed in [`memory/backlog-sig-archimate-ontology-2026-05-21.md`](../../../memory/backlog-sig-archimate-ontology-2026-05-21.md).

## What it does

- **`parseBookend(filePath)`** — reads a `LEFT-BOOKEND.md`, returns a `ContractGraph` (in-memory tree of Principles, Constraints, Services, Processes, DataObjects, Hypotheses, plus composition declarations).
- **`commitContract(graph, { namespace })`** — writes the `ContractGraph` to PolyGraph, anchored via `HAS_CONTRACT` to the `Solution` node tagged with that `namespace`. Idempotent — re-committing the same `ContractGraph` (or any version with the same `contractId`) clears the prior subgraph first.
- **`listContracts(namespace)`** / **`showContract(name, namespace)`** — read-side helpers; the basis of `asi contracts list` and `asi contracts show`.

## Expected `LEFT-BOOKEND.md` shape

The parser is intentionally narrow: it expects the canonical bookend shape exemplified by [`archetypes/events-spine/LEFT-BOOKEND.md`](../../archetypes/events-spine/LEFT-BOOKEND.md). Future bookends are expected to follow the same conventions.

### 1. YAML front-matter (recommended)

```yaml
---
archetypeName: events-spine
archetypeKind: composite           # composite | primitive | meta-pattern
archetypeVersion: v0.1.0-pre       # or "lifted-YYYY-MM-DD" for retroactive lifts
---
```

Without front-matter, the parser falls back to inferring `archetypeName` from the parent directory name (e.g. `archetypes/events-spine/LEFT-BOOKEND.md` → `events-spine`) and defaults `archetypeKind` to `primitive` and `archetypeVersion` to `lifted-<today>`.

### 2. Sections by keyword

Section headers are matched by case-insensitive substring against `## ` headings. The roman-numeral / parenthetical-suffix prefixes are ignored. All sections are optional; a primitive without `## Processes` just produces zero `Process` nodes.

| Keyword in heading | Becomes |
|---|---|
| Principle | `Principle[]` |
| Constraint | `Constraint[]` |
| Service | `Service[]` |
| Process | `Process[]` |
| DataObject / "Data Objects" | `DataObject[]` |
| Composition | `composes: string[]` |
| Hypothesis / Hypotheses | `Hypothesis[]` |

### 3. Items by `### ` header with key

Within a section, items are `### ` headers in the form:

- `### P1: <name>` or `### Principle P1: <name>`
- `### C2: <name>` or `### Constraint C2: <name>`
- `### S3: <name>` or `### Service S3: <name>`
- `### Pr1: <name>` or `### Process Pr1: <name>`
- `### DO1: <name>` or `### DataObject DO1: <name>`

Hypotheses also support a **numbered-list shape** (`1. Foo. 2. Bar.`) for compatibility with the events-spine and simple-auth bookends; numbered hypotheses are keyed sequentially `H1`, `H2`, ...

### 4. Field extraction (bold labels)

Within each item's body, fields are pulled by bold labels:

- **Principle:** `**Driver:**`, `**Consequences:**` (bullet list), `**Alternative considered:**` (or `**Alternative:**`)
- **Constraint:** `**Rationale:**`
- **Service:** the first fenced code block becomes `signature`
- **Process:** `**Trigger:**`, `**Cadence:**`
- **DataObject:** the first fenced code block becomes `schemaHint`

A field that doesn't appear becomes an empty string (or empty array). The parser stays quiet about missing labels — the canonical form documents what to write; missing data is a bookend-quality signal, not a parser error.

### 5. Compositions (composite archetypes only)

Composite archetypes declare their primitives via a markdown table:

```markdown
| Composed archetype | Kind | ... |
|---|---|---|
| `simple-pubsub` | primitive | ... |
| `simple-subscriber` | primitive | ... |
| `scribe` | primitive | ... |
| `mcp-proxy` | meta-pattern | ... |
```

The parser pulls archetype names from the backtick-wrapped first column. Bullet-form compositions (`- ` followed by `` `name` ``) also work.

## Cypher schema

The committer writes the following node and edge labels (see [`METHODOLOGY.md`](../../archetypes/METHODOLOGY.md) §SIG ↔ archetype tracing for the ontology rationale):

- Nodes: `Contract`, `Principle`, `Constraint`, `Service`, `Process`, `DataObject`, `Hypothesis`, `AcceptanceCriterion`. Each carries `contractId` + `namespace` properties for scoped idempotent clears.
- Edges from `Contract`: `DECLARES_PRINCIPLE`, `DECLARES_CONSTRAINT`, `DECLARES_SERVICE`, `DECLARES_PROCESS`, `DECLARES_DATAOBJECT`, `DECLARES_HYPOTHESIS`.
- Composition edges: `COMPOSES` between Contract nodes (resolved when the child contracts exist).
- Anchor edge: `HAS_CONTRACT` from the `Solution` root to each `Contract`.

## Usage

### From a script

```typescript
import { parseBookend, commitContract } from '@asi/contract-loader';

const graph = parseBookend('/path/to/archetypes/events-spine/LEFT-BOOKEND.md');
const summary = await commitContract(graph, { namespace: 'asi' });
console.log(summary);
// → { contractId: 'events-spine-v0.1.0-pre', nodeCount: 28, edgeCount: 28, anchoredTo: 'Archetypes' }
```

### From the CLI

```bash
# load all canonical contracts into the asi SIG
npx tsx scripts/load-contracts.ts

# query loaded contracts
asi contracts list
asi contracts show events-spine
```

### Test isolation

Tests pin a synthetic namespace (`asi-test-contract-loader`, `asi-test-contracts-cli`) and seed their own `Solution` root so they never touch the operational `asi` namespace. The `afterAll` hooks clean up.

## Cross-references

- [`METHODOLOGY.md`](../../archetypes/METHODOLOGY.md) §Bookends, §SIG ↔ archetype tracing — the discipline this module realizes
- [`archetypes/events-spine/LEFT-BOOKEND.md`](../../archetypes/events-spine/LEFT-BOOKEND.md) — the canonical bookend shape
- [`archetypes/simple-auth/LEFT-BOOKEND.md`](../../archetypes/simple-auth/LEFT-BOOKEND.md) — the retroactive bookend used as the second parser smoke
- [`scripts/seed-solution.ts`](../scripts/seed-solution.ts) — the upstream prerequisite (you need a `Solution` root before you can anchor `Contract` nodes to it)
- [`scripts/load-contracts.ts`](../scripts/load-contracts.ts) — the canonical bootstrap that runs this module against the two v0.1.1-pre bookends
