/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.3.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Identity preservation" —
 *   Neo4j mints its own ids; we record the original elementId in
 *   `_originalId` so the importer can preserve audit-ledger references.
 *
 *   Ownership: asi-local.
 */

/**
 * Neo4j reader for `exportInstance`.
 *
 * Uses `neo4j-driver` to walk the graph. Filters to the supplied
 * namespace where the labels/properties carry one (Contract,
 * Hypothesis, Solution, etc. carry a `namespace` property in the
 * solution-intel substrate). Nodes without a `namespace` property
 * are emitted only if the caller chose to read them by setting the
 * namespace to a sentinel value — Phase 3 ships the conservative
 * default (namespace filter applied).
 *
 * @module backends/neo4j-reader
 */

import neo4j, { type Driver } from 'neo4j-driver';

import type { EdgeRow, NodeRow } from '../format.js';

export interface Neo4jReaderOptions {
  graphUrl: string;
  graphUser?: string;
  graphPass?: string;
}

export async function openNeo4jReader(
  opts: Neo4jReaderOptions,
): Promise<Neo4jReader> {
  const driver = neo4j.driver(
    opts.graphUrl,
    neo4j.auth.basic(opts.graphUser ?? 'neo4j', opts.graphPass ?? 'neo4j'),
  );
  // Probe — fail-fast if the URL is unreachable.
  const session = driver.session();
  try {
    await session.run('RETURN 1 AS _probe');
  } finally {
    await session.close();
  }
  return new Neo4jReader(driver);
}

export class Neo4jReader {
  readonly kind = 'neo4j' as const;

  constructor(private readonly driver: Driver) {}

  /**
   * Yield every node in the namespace.
   *
   * Cypher: `MATCH (n {namespace: $ns}) RETURN n`. The elementId is
   * extracted from the driver-provided record and inserted into
   * `properties._originalId` for the import-time mapping.
   *
   * // Why use namespace as the filter: solution-intel nodes carry it
   * // uniformly (the bookend parser writes it on Contract, Principle,
   * // Constraint, Service, Process, DataObject, Hypothesis; the
   * // Solution root carries it; `/code` ontology nodes carry an
   * // `adoptionId` that mirrors the namespace). For stores' Phase 2
   * // /code mining where some nodes carry no namespace, the operator
   * // can extend this filter; for Phase 3 the default holds.
   */
  async *readNodes(namespace: string): AsyncGenerator<NodeRow> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        'MATCH (n) WHERE n.namespace = $ns RETURN n',
        { ns: namespace },
      );
      for (const record of result.records) {
        const node = record.get('n');
        const originalId = String(node.elementId ?? node.identity.toString());
        const props: Record<string, unknown> = { ...node.properties };
        // Why both: `id` is the canonical original id (used by the
        // checksum and as the primary key for stable ordering);
        // `properties._originalId` is what the importer carries
        // forward when Neo4j mints a new elementId.
        props._originalId = originalId;
        yield {
          id: originalId,
          labels: Array.from(node.labels) as string[],
          properties: normalizeNeo4jProperties(props),
        };
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Yield every edge in the namespace.
   *
   * Cypher: `MATCH (a)-[r]->(b) WHERE a.namespace = $ns AND b.namespace = $ns
   *         RETURN r, a, b`.
   *
   * The relationship's original elementId is preserved in
   * `properties._originalId` so the importer can map old → new ids
   * for downstream consumers (the audit ledger references node ids,
   * not edge ids today — but the gap matters when a future ontology
   * stamps `evidenceEdgeId` into events).
   */
  async *readEdges(namespace: string): AsyncGenerator<EdgeRow> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        'MATCH (a)-[r]->(b) WHERE a.namespace = $ns AND b.namespace = $ns RETURN r, a, b',
        { ns: namespace },
      );
      for (const record of result.records) {
        const r = record.get('r');
        const a = record.get('a');
        const b = record.get('b');
        const originalId = String(r.elementId ?? r.identity.toString());
        const aId = String(a.elementId ?? a.identity.toString());
        const bId = String(b.elementId ?? b.identity.toString());
        const props: Record<string, unknown> = { ...r.properties };
        props._originalId = originalId;
        yield {
          id: originalId,
          startNode: aId,
          endNode: bId,
          type: r.type,
          properties: normalizeNeo4jProperties(props),
        };
      }
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

/**
 * Normalize Neo4j-driver values that don't JSON-serialize directly.
 *
 * The known cases are:
 *   - Integer (Neo4j's BigInt-ish type) → number
 *   - DateTime/Date/Time/Duration → ISO-8601 string
 *
 * Anything else passes through. The Phase 1c verifiedAt harmonization
 * is the canonical example of why this exists — agents already
 * defended against DateTime-vs-string mismatches on the read path.
 */
function normalizeNeo4jProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = normalizeValue(v);
  }
  return out;
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object') {
    // neo4j.Integer
    const anyV = v as { toNumber?: () => number; isInteger?: () => boolean };
    if (
      typeof anyV.toNumber === 'function' &&
      'low' in (v as object) &&
      'high' in (v as object)
    ) {
      return anyV.toNumber();
    }
    // neo4j.DateTime / Date / Time / Duration — all expose toString()
    if ('toString' in (v as object) && typeof (v as { toString(): string }).toString === 'function') {
      // Discriminate temporal classes by constructor name when available.
      const ctorName = (v as object).constructor?.name ?? '';
      if (
        ctorName === 'DateTime' ||
        ctorName === 'Date' ||
        ctorName === 'LocalDateTime' ||
        ctorName === 'LocalTime' ||
        ctorName === 'Time' ||
        ctorName === 'Duration'
      ) {
        return (v as { toString(): string }).toString();
      }
    }
  }
  return v;
}
