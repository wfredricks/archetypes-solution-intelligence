/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.5.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Schema migrations" — the
 *   catalog is exhaustive for every version pair the substrate
 *   claims to support. Phase 3 ships the plumbing; the catalog is
 *   empty because v0.2.0-pre is the baseline.
 *
 *   Ownership: asi-local. Lifts to canonical reference-impl.
 */

/**
 * Migrations catalog.
 *
 * A Migration bridges one schema-version pair (e.g. 0.2.0-pre → 0.3.0).
 * Migrations are deterministic and idempotent — running one twice has
 * the same effect as running it once. Each migration records itself
 * in the audit ledger as `instance.migration.applied` after success.
 *
 * Phase 3 ships **zero** migrations. The first real schema change
 * will register the first entry. This file exists so the importer
 * has a stable lookup point and so CI can verify the catalog is
 * exhaustive for every declared version pair.
 *
 * @module migrations/index
 */

/**
 * A backend handle is opaque at this layer; the migration receives
 * whatever the importer passes. We type it loosely so the catalog
 * compiles without coupling to either backend adapter.
 */
export type MigrationBackendHandle = unknown;

/** Context handed to a migration's `run` function. */
export interface MigrationContext {
  /** ISO-8601 timestamp when the migration started. */
  readonly startedAt: string;
  /** The instance's Solution namespace. */
  readonly namespace: string;
  /** Path to the audit ledger (so the migration can append its event). */
  readonly auditPath?: string;
}

/** Result reported by a successful migration. */
export interface MigrationResult {
  /** Migration name (matches Migration.name). */
  readonly name: string;
  /** How many nodes/edges/audit events were touched. */
  readonly nodesAffected: number;
  readonly edgesAffected: number;
  /** Free-form summary appended to the audit event. */
  readonly summary?: string;
}

/**
 * One migration in the catalog.
 *
 * `fromVersion`/`toVersion` identify the schema-version pair this
 * migration bridges. `automatic = true` migrations run as part of
 * `importInstance`; `automatic = false` migrations produce a finding
 * at import time and require an operator action (see
 * INSTANCE-PORTABILITY.md §"Schema migrations").
 */
export interface Migration {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly name: string;
  readonly automatic: boolean;
  run(backend: MigrationBackendHandle, ctx: MigrationContext): Promise<MigrationResult>;
}

/**
 * The catalog. Empty in Phase 3. New migrations are appended in the
 * order they were introduced. The order does not determine application
 * order — `findMigrationChain` does that via BFS over fromVersion →
 * toVersion edges.
 */
export const migrations: ReadonlyArray<Migration> = [];

/**
 * Find a migration chain from `fromVersion` to `toVersion`.
 *
 * BFS over the migrations catalog treating each migration as a
 * directed edge (fromVersion → toVersion). Returns the chain in
 * application order. Throws an informative error if no chain exists.
 *
 * For Phase 3 with an empty catalog:
 *   - `findMigrationChain('x', 'x')` returns `[]` (no migrations needed)
 *   - `findMigrationChain('x', 'y')` throws (no path)
 *
 * The thrown error names both versions so the operator gets an
 * actionable message.
 */
export function findMigrationChain(
  fromVersion: string,
  toVersion: string,
): Migration[] {
  if (fromVersion === toVersion) return [];

  // BFS. Each frontier entry is (version, chain-so-far).
  const queue: Array<{ version: string; chain: Migration[] }> = [
    { version: fromVersion, chain: [] },
  ];
  const visited = new Set<string>([fromVersion]);

  while (queue.length > 0) {
    const { version, chain } = queue.shift()!;
    for (const m of migrations) {
      if (m.fromVersion !== version) continue;
      const next = [...chain, m];
      if (m.toVersion === toVersion) return next;
      if (!visited.has(m.toVersion)) {
        visited.add(m.toVersion);
        queue.push({ version: m.toVersion, chain: next });
      }
    }
  }

  throw new Error(
    `no migration registered for ${fromVersion} → ${toVersion}. ` +
      `Update @asi/instance/src/migrations/ or upgrade the substrate to a version ` +
      `that knows the path.`,
  );
}
