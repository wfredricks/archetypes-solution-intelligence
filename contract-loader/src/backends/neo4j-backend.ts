/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-1E-PLAN.md §1e.2.
 *
 *   Ownership: asi-local. Wraps the prior `neo4j-driver` plumbing from
 *   `commit-contract.ts` + `query-contracts.ts` (Phase 1c) behind the
 *   `Backend` interface so callers do not import `neo4j-driver`
 *   directly. Behavior is byte-for-byte identical to the pre-Phase-1e
 *   path: same cypher, same `session.run()` shape, same parameter
 *   binding.
 */

/**
 * Neo4j implementation of {@link Backend}.
 *
 * // Why: this is the default backend; existing asi tests rely on it
 * // being indistinguishable from direct `session.run()` calls. The
 * // class is a thin shim — every method is one `session.run()` plus
 * // a `records.map(r => r.toObject())`.
 *
 * @module backends/neo4j-backend
 */

import neo4j, { type Driver, type Record as Neo4jRecord } from 'neo4j-driver';

import type { Backend, BackendOptions } from './types.js';

const DEFAULT_GRAPH_URL = 'bolt://localhost:7689';
const DEFAULT_GRAPH_USER = 'neo4j';
const DEFAULT_GRAPH_PASS = 'udt-pass-2026';

export class Neo4jBackend implements Backend {
  readonly kind = 'neo4j' as const;

  private constructor(
    private readonly driver: Driver,
    private readonly ownsDriver: boolean,
  ) {}

  /**
   * Constructs a Neo4j backend from the option object.
   *
   * If `options.driver` is supplied, the backend wraps it without
   * taking ownership (close() becomes a no-op). Otherwise the backend
   * connects to `options.graphUrl` (defaulting to `bolt://localhost:7689`)
   * and takes ownership.
   */
  static async open(options: BackendOptions): Promise<Neo4jBackend> {
    if (options.driver) {
      return new Neo4jBackend(options.driver, false);
    }
    const driver = neo4j.driver(
      options.graphUrl ?? DEFAULT_GRAPH_URL,
      neo4j.auth.basic(
        options.graphUser ?? DEFAULT_GRAPH_USER,
        options.graphPass ?? DEFAULT_GRAPH_PASS,
      ),
    );
    return new Neo4jBackend(driver, true);
  }

  /**
   * Expose the underlying driver for callers that still need direct
   * access (notably tests that want to issue their own
   * `session.run()` calls against the same connection).
   *
   * // Why: the Phase 1c test suite reaches into the driver to seed
   * // and tear down the test namespace. Hiding the driver would
   * // force us to add new backend methods (`seed`, `wipeNamespace`)
   * // purely for tests — not worth it.
   */
  getDriver(): Driver {
    return this.driver;
  }

  async query(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<Array<Record<string, unknown>>> {
    const session = this.driver.session();
    try {
      const res = await session.run(cypher, params);
      return res.records.map((r: Neo4jRecord) => recordToPlainObject(r));
    } finally {
      await session.close();
    }
  }

  /**
   * Neo4j implementations of the bridge-free native primitives. These
   * exist so `verifyContract` can share a single code path that issues
   * `backend.native.*` regardless of backend.
   *
   * // Why even on Neo4j: keeps the verify path identical in shape
   * // across both backends. We could have kept the OPTIONAL MATCH /
   * // WITH / count cypher on Neo4j only and used native on PolyGraph,
   * // but that would have meant two different verify implementations
   * // and a real risk of behavior drift. One implementation, two
   * // backends.
   */
  native = {
    findNodes: async (
      label: string,
      filter?: Record<string, unknown>,
    ): Promise<Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>> => {
      const session = this.driver.session();
      try {
        const where = filterToCypher('n', filter);
        const res = await session.run(
          `MATCH (n:\`${label}\`) ${where.clause} RETURN id(n) AS id, labels(n) AS labels, n AS node`,
          where.params,
        );
        return res.records.map((r: Neo4jRecord) => {
          const node = r.get('node') as { properties: Record<string, unknown> };
          return {
            id: String(r.get('id').toNumber?.() ?? r.get('id')),
            labels: r.get('labels') as string[],
            properties: node.properties,
          };
        });
      } finally {
        await session.close();
      }
    },
    findRelationships: async (
      type: string,
      filter?: Record<string, unknown>,
    ): Promise<
      Array<{
        id: string;
        startNode: string;
        endNode: string;
        properties: Record<string, unknown>;
      }>
    > => {
      const session = this.driver.session();
      try {
        const where = filterToCypher('r', filter);
        const res = await session.run(
          `MATCH (a)-[r:\`${type}\`]->(b) ${where.clause}
           RETURN id(r) AS id, id(a) AS startId, id(b) AS endId, r AS rel`,
          where.params,
        );
        return res.records.map((r: Neo4jRecord) => {
          const rel = r.get('rel') as { properties: Record<string, unknown> };
          return {
            id: String(r.get('id').toNumber?.() ?? r.get('id')),
            startNode: String(r.get('startId').toNumber?.() ?? r.get('startId')),
            endNode: String(r.get('endId').toNumber?.() ?? r.get('endId')),
            properties: rel.properties,
          };
        });
      } finally {
        await session.close();
      }
    },
  };

  async close(): Promise<void> {
    if (this.ownsDriver) {
      await this.driver.close();
    }
  }
}

/**
 * Convert a Neo4j `Record` into a plain `{key: value}` object,
 * unwrapping `neo4j.Integer` into `number` to match the shape
 * PolyGraph's bridge returns.
 *
 * // Why unwrap: cypher `count(...)` and `id(...)` come back as
 * // neo4j.Integer. Calling `.toNumber()` everywhere downstream is
 * // tedious; unwrapping at the boundary keeps the contract simple
 * // ("rows are plain objects with primitive values"). Hypothesis
 * // counts and edge counts are well under MAX_SAFE_INTEGER for any
 * // realistic contract.
 */
function recordToPlainObject(record: Neo4jRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of record.keys as string[]) {
    out[key] = unwrap(record.get(key));
  }
  return out;
}

function unwrap(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  // neo4j.Integer has a `.toNumber()` method. Detect by the duck-shape.
  if (typeof v === 'object' && 'toNumber' in (v as object) && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    try {
      return (v as { toNumber: () => number }).toNumber();
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * Translate a simple equality filter into a `WHERE` clause for Neo4j.
 * The filter is `{prop: value}` — only equality on properties of the
 * matched node/relationship variable `varName` is supported, which is
 * all `verifyContract` needs.
 */
function filterToCypher(
  varName: string,
  filter?: Record<string, unknown>,
): { clause: string; params: Record<string, unknown> } {
  if (!filter || Object.keys(filter).length === 0) {
    return { clause: '', params: {} };
  }
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(filter)) {
    const paramName = `f_${i++}`;
    conds.push(`${varName}.\`${k}\` = $${paramName}`);
    params[paramName] = v;
  }
  return { clause: `WHERE ${conds.join(' AND ')}`, params };
}
