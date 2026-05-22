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
 * The known relationship types written by the solution-intel substrate
 * across all archetypes seen to date. Used by the exporter to drive
 * `findRelationships(type)` because PolyGraph v0.1.4 does not expose
 * a "list all rels" API.
 *
 * // Why hard-coded: at v0.1.4 the bridge has no `MATCH ()-[r]->()`
 * // and the API has no `allRelationships()`. Enumerating known types
 * // is the boundary the substrate already maintains in
 * // contract-loader's wipe pattern. If a new edge type is introduced
 * // (a new archetype's contract, a future /imp ontology, etc.), this
 * // list must grow. The Phase 3 FINDINGS calls this out as a gap that
 * // resolves when PolyGraph's qengine ships full graph iteration.
 *
 * The set is empirically derived from:
 *   - contract-loader (HAS_CONTRACT, DECLARES_*, COMPOSES)
 *   - stores Phase 2 /code ontology (HAS_BUSINESS_RULE, IMPLEMENTS,
 *     EXTERNAL_CALL_TO, DERIVED_FROM, BACKED_BY)
 *
 * If the exporter detects a node that has neighbors via a type NOT in
 * this list, it surfaces a warning rather than silently dropping the
 * edge.
 */
const KNOWN_REL_TYPES: readonly string[] = [
  // /contract ontology (from contract-loader + canonical solution-intel)
  'HAS_CONTRACT',
  'DECLARES_PRINCIPLE',
  'DECLARES_CONSTRAINT',
  'DECLARES_SERVICE',
  'DECLARES_PROCESS',
  'DECLARES_DATAOBJECT',
  'DECLARES_HYPOTHESIS',
  'COMPOSES',
  'OWNS',
  'PRODUCES',
  // /code ontology (from stores Phase 2 mining)
  'HAS_BUSINESS_RULE',
  'IMPLEMENTS',
  'EXTERNAL_CALL_TO',
  'DERIVED_FROM',
  'BACKED_BY',
  'CONTAINS',
  'CALLS',
  'DEFINED_IN',
  'PART_OF',
  'INVOKES',
];

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
   * Iterates `KNOWN_REL_TYPES` and unions the result. Edge ids cannot
   * be preserved on create, so the original id is recorded both as
   * `id` on the row AND as `properties._originalId` for symmetry
   * with the Neo4j path.
   */
  async *readEdges(_namespace: string): AsyncGenerator<EdgeRow> {
    for (const type of KNOWN_REL_TYPES) {
      const rels = await this.graph.findRelationships(type);
      for (const r of rels) {
        const props: Record<string, unknown> = { ...r.properties };
        // Why preserve _originalId in props: PolyGraph mints a fresh
        // UUID on createRelationship — there is no caller-chosen id.
        // To make a round-trip idempotent (re-exporting a round-tripped
        // instance must produce the SAME sigChecksum), the exporter
        // anchors the row's `id` to whichever id was the FIRST one
        // assigned: source exports stamp `_originalId = r.id` on the
        // first read; subsequent reads of round-tripped relationships
        // read the already-stamped `_originalId` from properties. The
        // row's `id` field follows the same anchor so on-disk bytes
        // match across re-exports.
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
