# @asi/agents

Pure-read agents that walk the asi Solution Intelligence Graph (SIG) and emit
findings. Both agents are **read-only on the SIG** — they observe and report
but never mutate.

## Agents shipped at `0.1.0-pre`

### CompletenessAgent

Walks the SIG for one namespace and emits findings about gaps: open or stale
hypotheses, contracts with no hypotheses, orphan DataObjects, Services with no
Process. Run it weekly during active development to catch drift early.

Rules (v0.1):

| Rule id | Severity | When it fires |
|---|---|---|
| `completeness:hypothesis-open` | info | Hypothesis `status='open'` (expected pre-adoption) |
| `completeness:hypothesis-partial` | warn | Hypothesis `status='partial'` (incomplete evidence) |
| `completeness:hypothesis-violated` | error | Hypothesis `status='violated'` |
| `completeness:hypothesis-stale` | warn | `status='held'` but `verifiedAt` null OR > 90 days old |
| `completeness:contract-no-hypotheses` | warn | Contract has zero `DECLARES_HYPOTHESIS` edges |
| `completeness:dataobject-orphan` | info | DataObject has no incoming `OWNS` / `PRODUCES` edge |
| `completeness:service-no-process` | info | Service exists with no associated Process |

### BookendAuditAgent

For a given archetype, regenerates the right-bookend snapshot from current SIG
state and diffs it against the committed `RIGHT-BOOKEND-snapshot-*.md` file in
the `archetypes` repo. Emits findings about drift but **does not commit a
refreshed snapshot** — a human decides whether to regenerate.

Rules (v0.1):

| Rule id | Severity | When it fires |
|---|---|---|
| `bookend-audit:missing-snapshot` | error | No `RIGHT-BOOKEND-snapshot-*.md` for this archetype |
| `bookend-audit:hypothesis-added` | warn | Hypothesis in SIG but not in committed snapshot |
| `bookend-audit:hypothesis-removed` | error | Hypothesis in committed snapshot but not in SIG |
| `bookend-audit:status-drift` | warn | Status differs between SIG and committed snapshot |
| `bookend-audit:verifiedAt-drift` | info | `verifiedAt` differs |
| `bookend-audit:in-sync` | info | Committed snapshot matches SIG perfectly |

## Use from the CLI

```sh
asi agents list
asi agents completeness run --namespace asi --format markdown
asi agents bookend-audit run --archetype events-spine \
  --archetypes-repo /path/to/archetypes --namespace asi
```

## Use from code

```ts
import { runCompletenessAgent, runBookendAuditAgent } from '@asi/agents';

const report = await runCompletenessAgent({ namespace: 'asi' });
console.log(`${report.summary.error} errors, ${report.summary.warn} warnings`);
```

## Provenance

Originated 2026-05-22 in the asi adoption under
`artifacts/si-runtime/BUILD-PHASE-1B-PLAN.md`. This package becomes
`archetypes/solution-intel/reference-impl/agents/` in the archetype's next
snapshot lift.

🖇️ *Pure-read agents. Observe, never mutate. The SIG is upstream truth; the
agents are downstream readers.*
