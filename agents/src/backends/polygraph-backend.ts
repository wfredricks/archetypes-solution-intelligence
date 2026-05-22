/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-2_5-PLAN.md §2.5.3.
 *
 *   Lift origin: pattern lifted from `contract-loader/src/backends/polygraph-backend.ts`
 *   (Phase 1e). The cypher patterns the agents emit are different
 *   from contract-loader's writer/reader patterns, so the per-pattern
 *   dispatchers here cover the agent surface only.
 *
 *   Ownership: asi-local. Implements the `Backend` interface against
 *   `polygraph-db@0.1.4` (LevelAdapter), bridging the two simple
 *   MATCH+RETURN sites in the agents (CompletenessAgent rule 1 +
 *   BookendAuditAgent's hypothesis read) onto PolyGraph's regex
 *   bridge with `$param` substitution. The three aggregation sites
 *   (CompletenessAgent rules 2/3/4) DO NOT go through the bridge —
 *   they call the native helpers on `Backend.native`. See plan
 *   §2.5.3 #4 for the agent-side branching contract.
 */

/**
 * PolyGraph implementation of {@link Backend}.
 *
 * ## Why a separate backend
 *
 * The agents package was hard-coupled to Neo4j through Phase 1b.
 * Phase 1d/1e built out PolyGraph (bridge + adapter pattern) for
 * contract-loader, and Phase 2 stood up stores' end-to-end PolyGraph
 * SIG. Phase 2.5 closes the loop: the agents now work against
 * PolyGraph too, unblocking `stores agents completeness run`.
 *
 * ## Bridge usage
 *
 * Two query sites are bridge-compatible (simple MATCH … RETURN with
 * inline-property filters):
 *
 *   - CompletenessAgent rule 1 — hypothesis sweep
 *   - BookendAuditAgent — hypothesis read for snapshot diff
 *
 * These go through `query()` here, which substitutes `$paramName`
 * into the cypher (the bridge does not bind parameters as of v0.1.4)
 * and forwards to `engine.query()`.
 *
 * ## Native usage
 *
 * Three query sites are NOT bridge-compatible — they use
 * `OPTIONAL MATCH + WITH + count(...)` which is qengine territory.
 * The agents call `backend.native.countOutgoingRels(...)` or
 * `backend.native.countIncomingRels(...)` directly for those, and
 * the agent code branches on `backend.kind` to issue the right call.
 *
 * Per BUILD-PHASE-2_5-PLAN.md §"Hard constraints" #3 the bridge
 * stays at v0.1.4; the discipline is "agents pick the right tool per
 * query" not "push the bridge to grow OPTIONAL MATCH".
 *
 * @module backends/polygraph-backend
 */

import { LevelAdapter, PolyGraph } from 'polygraph-db';

import type { Backend, BackendOptions } from './types.js';

export class PolyGraphBackend implements Backend {
  readonly kind = 'polygraph' as const;

  private constructor(private readonly graph: PolyGraph) {}

  /**
   * Constructs a PolyGraph backend from the option object.
   *
   * Requires `options.polygraphPath` — the leveldb directory. Each
   * call opens a fresh graph instance; callers MUST `close()` when
   * done to release the leveldb lock.
   */
  static async open(options: BackendOptions): Promise<PolyGraphBackend> {
    const path = options.polygraphPath;
    if (!path) {
      throw new Error(
        'polygraph backend requires options.polygraphPath (a leveldb directory)',
      );
    }
    const adapter = new LevelAdapter({ path });
    const graph = new PolyGraph({ adapter });
    await graph.open();
    return new PolyGraphBackend(graph);
  }

  /**
   * Execute a cypher query through the PolyGraph regex bridge with
   * `$param` substitution. The two cypher patterns the agents emit
   * that reach here are both `MATCH … RETURN <projection> ORDER BY
   * …` — bridge-compatible per Phase 1d.
   *
   * Adapter-side compensations:
   *
   *   1. `$param` substitution from the supplied `params` object,
   *      JSON-encoding strings so embedded commas/quotes survive.
   *   2. JavaScript `ORDER BY` post-sort, because the bridge silently
   *      accepts but does not execute `ORDER BY` (qengine territory).
   *
   * // Why no write-path short-circuits like contract-loader's adapter
   * // has: agents are read-only — they never CREATE/MERGE/DELETE.
   * // The aggregation sites are handled via `native.*` helpers, not
   * // via this method.
   */
  async query(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<Array<Record<string, unknown>>> {
    const inlined = inlineParams(cypher, params);

    // Detect and strip ORDER BY before sending to the bridge (bridge
    // silently accepts but does not execute it); sort in JS after.
    const orderByMatch = /\bORDER\s+BY\s+([\s\S]+?)\s*$/i.exec(inlined);
    let queryToRun = inlined;
    let postSortKeys: string[] | null = null;
    if (orderByMatch) {
      const orderByExpr = orderByMatch[1].trim();
      queryToRun = inlined.slice(0, orderByMatch.index).trim();
      postSortKeys = parseOrderByKeys(orderByExpr);
    }

    const raw = (await this.graph.query(queryToRun)) as Array<Record<string, unknown>>;
    const rows: Array<Record<string, unknown>> = raw.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v;
      }
      return out;
    });
    if (postSortKeys) sortRowsByKeys(rows, postSortKeys);
    return rows;
  }

  /**
   * Native primitives.
   *
   * `findNodes` / `findRelationships` delegate to PolyGraph's own
   * methods (already shaped close to our interface) and normalize id
   * fields to strings.
   *
   * `countOutgoingRels` / `countIncomingRels` use PolyGraph's
   * `getNeighbors(nodeId, types, direction)` which returns
   * `{node, relationship}` pairs — we count the pairs.
   */
  native = {
    findNodes: async (
      label: string,
      filter?: Record<string, unknown>,
    ): Promise<Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>> => {
      const pgFilter = simpleFilterToPolyGraph(filter);
      const nodes = await this.graph.findNodes(label, pgFilter);
      return nodes.map((n) => ({
        id: String(n.id),
        labels: n.labels,
        properties: n.properties,
      }));
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
      const pgFilter = simpleFilterToPolyGraph(filter);
      const rels = await this.graph.findRelationships(type, pgFilter);
      return rels.map((r) => ({
        id: String(r.id),
        startNode: String(r.startNode),
        endNode: String(r.endNode),
        properties: r.properties,
      }));
    },
    countOutgoingRels: async (
      nodeId: string,
      types?: string[],
    ): Promise<number> => {
      // Why getNeighbors and not findRelationships(type).filter:
      // PolyGraph's `findRelationships` materializes every rel of
      // that type across the entire graph; `getNeighbors(nodeId, ...)`
      // walks from one node and returns only its adjacencies. On the
      // 21,002-node dla-stores SIG the difference is hundreds of
      // thousands of rels vs O(degree(node)) — important for
      // completeness-agent's per-Contract loops.
      const neighbors = await this.graph.getNeighbors(nodeId, types, 'outgoing');
      return neighbors.length;
    },
    countIncomingRels: async (
      nodeId: string,
      types?: string[],
    ): Promise<number> => {
      const neighbors = await this.graph.getNeighbors(nodeId, types, 'incoming');
      return neighbors.length;
    },
  };

  async close(): Promise<void> {
    await this.graph.close();
  }
}

/**
 * Substitute `$paramName` in a cypher string with the value from
 * `params`, JSON-encoded for safe inlining.
 *
 * Uses a single regex pass with a substitution function so a value
 * containing `$something` text cannot trigger a cascading replacement.
 *
 * Byte-identical behavior to contract-loader/src/backends/polygraph-backend.ts
 * `inlineParams` — same JSON-encoding for strings, same numeric/
 * boolean handling, same null handling.
 */
function inlineParams(cypher: string, params: Record<string, unknown>): string {
  return cypher.replace(/\$([A-Za-z_]\w*)/g, (_match, name: string) => {
    if (!(name in params)) {
      return `$${name}`;
    }
    const v = params[name];
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  });
}

/**
 * Parse the ORDER BY expression into a list of result-row alias keys.
 *
 * Supports the agent's two real shapes:
 *   - `c.archetypeName, h.key` (CompletenessAgent rule 1)
 *   - `h.key`                  (BookendAuditAgent)
 *
 * Pattern: split on commas, strip optional `ASC|DESC`, take the part
 * after the last dot as the row alias. The agents' RETURN clauses
 * always use `<var>.<prop> AS <prop>`, so the alias equals the
 * property name.
 */
function parseOrderByKeys(expr: string): string[] {
  const cleaned = expr.replace(/;\s*$/, '').trim();
  return cleaned
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const noDir = part.replace(/\s+(ASC|DESC)\s*$/i, '').trim();
      const dotIdx = noDir.lastIndexOf('.');
      return dotIdx >= 0 ? noDir.slice(dotIdx + 1) : noDir;
    });
}

/**
 * Stable multi-key sort by row keys. Treats null/undefined as
 * sorts-last, numbers numerically, strings lexicographically.
 */
function sortRowsByKeys(rows: Array<Record<string, unknown>>, keys: string[]): void {
  rows.sort((a, b) => {
    for (const k of keys) {
      const av = a[k];
      const bv = b[k];
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        const c = av - bv;
        if (c !== 0) return c;
        continue;
      }
      const c = String(av).localeCompare(String(bv));
      if (c !== 0) return c;
    }
    return 0;
  });
}

/**
 * Translate the simple `{prop: value}` filter shape we use across
 * backends into PolyGraph's `PropertyFilter` shape (which uses
 * comparator objects like `{$eq: value}`).
 */
function simpleFilterToPolyGraph(
  filter: Record<string, unknown> | undefined,
): Record<string, { $eq: unknown }> | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  const out: Record<string, { $eq: unknown }> = {};
  for (const [k, v] of Object.entries(filter)) {
    out[k] = { $eq: v };
  }
  return out;
}
