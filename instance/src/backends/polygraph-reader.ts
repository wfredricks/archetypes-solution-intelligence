/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.2.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Identity preservation" —
 *   PolyGraph node ids are preserved verbatim.
 *
 *   Ownership: asi-local.
 */

/**
 * PolyGraph reader for `exportInstance`.
 *
 * Walks the leveldb store and yields every node and every edge in a
 * shape suitable for `sig/nodes.jsonl` and `sig/edges.jsonl`. Node ids
 * are preserved verbatim (PolyGraph's `createNode` accepts an `id`
 * argument so they round-trip natively). Edge ids cannot be preserved
 * on create — we surface them in `properties._originalId` for both
 * backends uniformly. See INSTANCE-PORTABILITY.md §"Identity preservation"
 * and Phase 3 FINDINGS for the gap detail.
 *
 * @module backends/polygraph-reader
 */

import { LevelAdapter, PolyGraph } from 'polygraph-db';

import type { EdgeRow, NodeRow } from '../format.js';

/**
 * Note on PolyGraph v0.1.4 iteration:
 *
 * `polygraph-db` at v0.1.4 does not expose an `allRelationships()`
 * primitive, and `findRelationships(type)` filters by a single type.
 * We side-step the limitation by walking every node returned by
 * `allNodes()` and collecting its outgoing edges via
 * `getNeighbors(nodeId, undefined, 'outgoing')`. This yields every
 * relationship in the graph exactly once (each edge has exactly one
 * start-node owner) and is robust against unknown edge types — a new
 * archetype's edge type appears in the export without any code change
 * here.
 *
 * Why outgoing-only: a relationship has one tail and one head; the
 * tail's outgoing list contains it once. Counting both directions
 * would double-emit every edge.
 */

/**
 * Open a PolyGraph reader. The caller MUST call `close()` when done
 * (the leveldb otherwise stays locked).
 */
export async function openPolyGraphReader(
  polygraphPath: string,
): Promise<PolyGraphReader> {
  const adapter = new LevelAdapter({ path: polygraphPath });
  const graph = new PolyGraph({ adapter });
  await graph.open();
  return new PolyGraphReader(graph);
}

export class PolyGraphReader {
  readonly kind = 'polygraph' as const;

  constructor(private readonly graph: PolyGraph) {}

  /**
   * Yield every node in the instance.
   *
   * `namespace` is currently UNUSED — PolyGraph stores are
   * single-instance, so every node belongs to the namespace by
   * construction. Kept in the signature for parity with the Neo4j
   * reader, which uses it to filter the multi-tenant constellation
   * graph.
   *
   * The PolyGraph node id is emitted verbatim. The importer will
   * pass it back to `createNode(labels, props, id)` to round-trip
   * the identity.
   */
  async *readNodes(_namespace: string): AsyncGenerator<NodeRow> {
    const nodes = await this.graph.allNodes();
    for (const n of nodes) {
      yield {
        id: String(n.id),
        labels: n.labels,
        properties: n.properties,
      };
    }
  }

  /**
   * Yield every edge in the instance.
   *
   * Iterates every node, collects its outgoing edges. Each edge is
   * therefore visited exactly once. Edge ids cannot be preserved on
   * create (PolyGraph mints a UUID), so the original id is recorded
   * as `properties._originalId` for both backends uniformly. To keep
   * re-exports idempotent the row's `id` field is anchored to the
   * existing `_originalId` when one is present (round-tripped edges)
   * and to the live id when the source has never been exported.
   */
  async *readEdges(_namespace: string): AsyncGenerator<EdgeRow> {
    const nodes = await this.graph.allNodes();
    for (const n of nodes) {
      const out = await this.graph.getNeighbors(n.id, undefined, 'outgoing');
      for (const { relationship: r } of out) {
        const props: Record<string, unknown> = { ...r.properties };
        const anchorId =
          typeof props._originalId === 'string'
            ? props._originalId
            : String(r.id);
        if (props._originalId === undefined) {
          props._originalId = anchorId;
        }
        yield {
          id: anchorId,
          startNode: String(r.startNode),
          endNode: String(r.endNode),
          type: r.type,
          properties: props,
        };
      }
    }
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}
