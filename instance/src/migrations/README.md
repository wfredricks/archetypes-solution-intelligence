# Migrations Catalog

*Doctrine reference: `INSTANCE-PORTABILITY.md` §"Schema migrations".*

**Phase 3 status:** Empty by design. v0.2.0-pre is the baseline. The first real schema change will register the first migration here.

## How to add a migration

A migration is a TypeScript module that exports a `Migration` object satisfying the `Migration` interface in `./index.ts`:

```ts
// migration-0.2.0-pre-to-0.3.0-verifiedAt-iso.ts
import type { Migration } from './index.js';

export const migration_verifiedAtIso: Migration = {
  fromVersion: '0.2.0-pre',
  toVersion: '0.3.0',
  name: 'migration-0.2.0-pre-to-0.3.0-verifiedAt-iso',
  automatic: true,
  async run(backend, ctx) {
    // For every Hypothesis with verifiedAt as a Neo4j DateTime,
    // coerce to ISO-8601 string. Idempotent — if already a string,
    // leave alone. If null, leave null.
    let nodesAffected = 0;
    // ... actual implementation
    return {
      name: 'migration-0.2.0-pre-to-0.3.0-verifiedAt-iso',
      nodesAffected,
      edgesAffected: 0,
      summary: `coerced ${nodesAffected} Hypothesis.verifiedAt values to ISO-8601`,
    };
  },
};
```

Then add it to the `migrations` array in `./index.ts`:

```ts
import { migration_verifiedAtIso } from './migration-0.2.0-pre-to-0.3.0-verifiedAt-iso.js';

export const migrations: ReadonlyArray<Migration> = [
  migration_verifiedAtIso,
];
```

## Migration discipline

Per doctrine:

1. **Deterministic.** Same input produces same output. No reading clock, no random ids, no operator prompts.
2. **Idempotent.** Running twice has the same effect as running once.
3. **Named.** The `name` field is the canonical identifier (e.g. `migration-0.1.0-pre-to-0.2.0-pre-verifiedAt-iso`).
4. **Audit-recorded.** Every successful migration emits an `instance.migration.applied` event into the new audit ledger via the importer.
5. **Operator-assisted variants** (`automatic: false`) produce a finding at import time and a CLI command pointer for the operator action. The migration is not complete until the operator's action is recorded.

## Catalog discovery

`findMigrationChain(from, to)` in `index.ts` does BFS over registered migrations treating each as a directed edge. Returns the chain in application order. Throws an informative error if no chain exists. For an empty catalog and `from === to`, returns `[]`.

## Phase 3 acceptance

The Phase 3 round-trip integrity test pins the empty-catalog behavior:

- `migrations.length === 0` (sanity)
- `findMigrationChain('0.2.0-pre', '0.2.0-pre') === []` (no work needed)
- `findMigrationChain('0.1.0-pre', '0.2.0-pre')` throws (no path)
