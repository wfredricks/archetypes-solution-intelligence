/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.4.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Identity preservation" —
 *   Neo4j owns id allocation; we record the original elementId in
 *   `_originalId` and rebuild the audit-ledger mapping in
 *   ImportResult.nodeIdMap.
 *
 *   Ownership: asi-local.
 */

/**
 * Neo4j writer for `importInstance`.
 *
 * Each node is created via `CREATE (n:Label {properties})`; the new
 * elementId is returned and tracked in `nodeIdMap`. The exporter has
 * already stamped `properties._originalId` so a downstream consumer
 * can still resolve a node by its original id without consulting the
 * map.
 *
 * @module backends/neo4j-writer
 */

import neo4j, { type Driver } from 'neo4j-driver';

import type { EdgeRow, NodeRow } from '../format.js';

export interface Neo4jWriterOptions {
  graphUrl: string;
  graphUser?: string;
  graphPass?: string;
}

export async function openNeo4jWriter(
  opts: Neo4jWriterOptions,
): Promise<Neo4jWriter> {
  const driver = neo4j.driver(
    opts.graphUrl,
    neo4j.auth.basic(opts.graphUser ?? 'neo4j', opts.graphPass ?? 'neo4j'),
  );
  const session = driver.session();
  try {
    await session.run('RETURN 1 AS _probe');
  } finally {
    await session.close();
  }
  return new Neo4jWriter(driver);
}

export class Neo4jWriter {
  readonly kind = 'neo4j' as const;

  constructor(private readonly driver: Driver) {}

  async isEmpty(namespace: string): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        'MATCH (n) WHERE n.namespace = $ns OR n.adoptionId = $ns RETURN count(n) AS c',
        { ns: namespace },
      );
      const c = result.records[0]?.get('c');
      const n = typeof c === 'number' ? c : (c?.toNumber?.() ?? 0);
      return n === 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Create a node with the imported labels and properties. The
   * `_originalId` property carries the source id; the new elementId
   * is returned for the importer's nodeIdMap.
   *
   * // Why we don't use APOC: APOC isn't guaranteed across deployments.
   * // The cypher here is portable to community Neo4j and to the
   * // PolyGraph bridge (which doesn't see this code; it goes through
   * // its own writer).
   */
  async writeNode(row: NodeRow): Promise<string> {
    const labels = row.labels.length > 0 ? row.labels : ['_Node'];
    const labelClause = labels.map((l) => `\`${l}\``).join(':');
    const cypher = `CREATE (n:${labelClause} $props) RETURN elementId(n) AS id`;
    const session = this.driver.session();
    try {
      const result = await session.run(cypher, { props: row.properties });
      return String(result.records[0].get('id'));
    } finally {
      await session.close();
    }
  }

  /**
   * Create an edge by matching the (potentially-remapped) endpoint
   * elementIds and CREATEing the relationship.
   *
   * Throws if either endpoint cannot be matched. The importer catches
   * the throw and surfaces it as a warning so a single bad edge does
   * not abort the whole import.
   */
  async writeEdge(row: EdgeRow, nodeIdMap: Record<string, string>): Promise<string> {
    const startId = nodeIdMap[row.startNode] ?? row.startNode;
    const endId = nodeIdMap[row.endNode] ?? row.endNode;
    // For Neo4j we look up endpoints by their `_originalId` property
    // (preferred — survives a fresh import) and fall back to elementId.
    const cypher = `
      MATCH (a) WHERE elementId(a) = $startId OR a._originalId = $startId
      MATCH (b) WHERE elementId(b) = $endId OR b._originalId = $endId
      CREATE (a)-[r:\`${row.type}\` $props]->(b)
      RETURN elementId(r) AS id
    `;
    const session = this.driver.session();
    try {
      const result = await session.run(cypher, {
        startId,
        endId,
        props: row.properties,
      });
      if (result.records.length === 0) {
        throw new Error(
          `endpoint(s) not found: startNode=${row.startNode} endNode=${row.endNode}`,
        );
      }
      return String(result.records[0].get('id'));
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
