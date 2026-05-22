/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §B.6.
 *
 *   Ownership: asi-local.
 *
 * @module tests/completeness/fixtures
 */

/**
 * Mocked neo4j-driver session/driver for CompletenessAgent tests.
 *
 * // Why: the agent runs four Cypher queries per session. The fake
 * // session matches each by a substring of the cypher and returns the
 * // canned record set the test wants. This keeps tests fast and lets
 * // us cover edge cases (null verifiedAt, stale dates, unknown status)
 * // without needing a live Neo4j.
 */

import type { Driver, Session } from 'neo4j-driver';

/** Canned record set. Each record exposes a `get(field)` accessor. */
export type FakeRecord = Record<string, unknown>;

/** Mapping from a cypher substring to the records the fake should return. */
export interface FakePattern {
  match: string;
  records: FakeRecord[];
}

export interface FakeSessionOptions {
  patterns: FakePattern[];
  /** Recorded session.run calls (cypher + params). Tests assert against this. */
  calls?: { cypher: string; params: Record<string, unknown> }[];
}

/**
 * Build a fake driver whose `.session()` returns a fake session that
 * matches `run(cypher)` calls against `patterns` in order. First matching
 * pattern wins. Unmatched calls throw - the test then sees the missing
 * pattern.
 */
export function makeFakeDriver(opts: FakeSessionOptions): Driver {
  const session: Partial<Session> = {
    async run(cypher: string, params?: Record<string, unknown>) {
      opts.calls?.push({ cypher, params: params ?? {} });
      for (const p of opts.patterns) {
        if (cypher.includes(p.match)) {
          return {
            records: p.records.map(wrapRecord),
            summary: {} as never,
          } as never;
        }
      }
      throw new Error(`fake-session: no pattern matched cypher:\n${cypher}`);
    },
    async close() {
      /* no-op */
    },
  };
  const driver: Partial<Driver> = {
    session: () => session as Session,
    async close() {
      /* no-op */
    },
  };
  return driver as Driver;
}

function wrapRecord(obj: FakeRecord): { get: (field: string) => unknown; keys: string[] } {
  // Why `keys`: Phase 2.5's Neo4jBackend.query() iterates `record.keys`
  // to build a plain object (matching Neo4j's record.toObject shape
  // that the real driver exposes). The fake mirrors that surface so
  // the agent path stays uniform across real Neo4j, fake-Neo4j, and
  // PolyGraph.
  return {
    get(field: string) {
      return obj[field];
    },
    keys: Object.keys(obj),
  };
}

// ───────────────────────────────────────────────────────────────────
// Canned record builders
// ───────────────────────────────────────────────────────────────────

/** Build a hypothesis record matching the agent's SELECT shape. */
export function hypothesisRow(
  archetype: string,
  key: string,
  status: 'open' | 'held' | 'partial' | 'violated' | string,
  verifiedAt: string | null = null,
): FakeRecord {
  return { archetype, key, status, verifiedAt };
}

/** Build a contract-no-hypothesis record. */
export function noHypothesisContractRow(archetype: string): FakeRecord {
  return { archetype };
}

/** Build an orphan-dataobject record. */
export function orphanDataObjectRow(key: string, name?: string): FakeRecord {
  return { key, name: name ?? key };
}

/** Build a service-without-process record. */
export function serviceNoProcessRow(archetype: string, key: string, name?: string): FakeRecord {
  return { archetype, key, name: name ?? key };
}

/**
 * Cypher substrings the CompletenessAgent uses, one per rule cluster.
 *
 * // Why: each pattern must uniquely identify ONE of the four queries.
 * // The hypothesis sweep uses `DECLARES_HYPOTHESIS]->(h:Hypothesis`
 * // exactly once; the contracts-no-hypotheses query uses
 * // `OPTIONAL MATCH (c)-[:DECLARES_HYPOTHESIS]` plus a `WHERE
 * // hypothesisCount = 0`. We anchor patterns on substrings that appear
 * // in only one of the four queries.
 */
export const PATTERNS = {
  hypotheses: 'RETURN c.archetypeName AS archetype,\n            h.key AS key',
  contractsNoHypotheses: 'WHERE hypothesisCount = 0',
  orphanDataObjects: 'WHERE incomingCount = 0',
  servicesNoProcess: 'WHERE processCount = 0',
} as const;
