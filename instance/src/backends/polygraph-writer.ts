/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.4.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Identity preservation" —
 *   PolyGraph's `createNode(labels, props, id)` lets us round-trip
 *   the original node id natively.
 *
 *   Ownership: asi-local.
 */

/**
 * PolyGraph writer for `importInstance`.
 *
 * Uses `polygraph-db`'s `PolyGraph.createNode(labels, properties, id)`
 * three-arg form to preserve the original node id from the export.
 * Relationship ids cannot be preserved on create (PolyGraph mints a
 * UUID); the importer records the original-→-new mapping in
 * `ImportResult.edgeIdMap`.
 *
 * @module backends/polygraph-writer
 */

import { LevelAdapter, PolyGraph } from 'polygraph-db';

import type { EdgeRow, NodeRow } from '../format.js';

export async function openPolyGraphWriter(
  polygraphPath: string,
): Promise<PolyGraphWriter> {
  const adapter = new LevelAdapter({ path: polygraphPath });
  const graph = new PolyGraph({ adapter });
  await graph.open();
  return new PolyGraphWriter(graph);
}

export class PolyGraphWriter {
  readonly kind = 'polygraph' as const;

  constructor(private readonly graph: PolyGraph) {}

  /**
   * Cheap empty check: scan every persisted node. A namespace filter
   * cannot be applied to `allNodes()` directly (it returns Node
   * objects), so we apply it in JS. For large stores this is O(n) on
   * the source side; for an empty fresh store it is O(0). Acceptable
   * because the empty check runs at most once per import.
   */
  async isEmpty(namespace: string): Promise<boolean> {
    const nodes = await this.graph.allNodes();
    for (const n of nodes) {
      if (n.properties.namespace === namespace) return false;
      if (n.properties.adoptionId === namespace) return false;
    }
    return true;
  }

  /**
   * Apply a node row. Returns the id PolyGraph assigned — which
   * matches the row's `id` because PolyGraph honors the third
   * argument.
   *
   * // Why we still return the assigned id: the contract is uniform
   * // across backends. Neo4j cannot honor `id`; PolyGraph can. The
   * // caller's `nodeIdMap` only records entries where assigned ≠
   * // original, so on PolyGraph the map stays empty (zero overhead).
   */
  async writeNode(row: NodeRow): Promise<string> {
    const node = await this.graph.createNode(
      Array.from(row.labels),
      row.properties,
      row.id,
    );
    return String(node.id);
  }

  /**
   * Apply an edge row. PolyGraph mints a new relationship id; the
   * importer records the original-→-new mapping via the return value.
   *
   * The endpoints are remapped through `nodeIdMap` if non-empty (it
   * stays empty on PolyGraph, but we apply the lookup unconditionally
   * for symmetry with the Neo4j writer).
   */
  async writeEdge(row: EdgeRow, nodeIdMap: Record<string, string>): Promise<string> {
    const startId = nodeIdMap[row.startNode] ?? row.startNode;
    const endId = nodeIdMap[row.endNode] ?? row.endNode;
    const rel = await this.graph.createRelationship(
      startId,
      endId,
      row.type,
      row.properties,
    );
    return String(rel.id);
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}
