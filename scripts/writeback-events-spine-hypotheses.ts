/**
 * Writes Hypothesis status back to the SIG for the events-spine contract.
 * Sets H1–H5 status + evidence + verifiedAt (the reference-impl
 * hypotheses that the events-spine build itself verifies).
 *
 * Invoked at the end of the events-spine reference-impl build (Phase N½
 * of the BUILD-RECIPE). Run from this repo (archetypes-solution-
 * intelligence) so the neo4j-driver dep is resolvable.
 *
 * // Why: the SIG is the system of record for hypothesis state. The
 * // archetype's right bookend renders from the SIG, not from
 * // hand-edited markdown — anchoring evidence to the graph is the
 * // whole point of SIG-first methodology.
 *
 * // Idempotency: each run SETs the same status/evidence/verifiedAt on
 * // the targeted Hypothesis nodes. Re-running with the same UPDATES
 * // table is a no-op semantically (verifiedAt does advance to `now()`,
 * // which is intentional — the timestamp records when verification
 * // was last asserted).
 *
 * // Usage:
 * //   npx tsx scripts/writeback-events-spine-hypotheses.ts
 *
 * @module scripts/writeback-events-spine-hypotheses
 */

import neo4j from 'neo4j-driver';

const NAMESPACE = process.env.ASI_NAMESPACE ?? 'asi';
const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';

interface HypothesisUpdate {
  key: string;
  status: 'held' | 'partial' | 'violated' | 'untested';
  evidence: string;
}

const UPDATES: HypothesisUpdate[] = [
  {
    key: 'H1',
    status: 'held',
    evidence:
      'All five Principles P1-P5 honored in reference-impl. P1: default subject filter is ">" (scribe.test.ts "subscribes to > by default"). P2: canonical ScribeEvent shape owned by Scribe (file-backend.test.ts DO1 round-trip). P3: publisher.publish returns void synchronously (publisher.test.ts "does not block on subscriber acknowledgement"). P4: scribe.ts hands events to backend.write unchanged (scribe.test.ts "writes every delivered event to the backend"). P5: MCP server (mcp-server.ts) exposes only scribe.query/scribe.tail/scribe.summary; no backend-specific tools leak through.',
  },
  {
    key: 'H2',
    status: 'held',
    evidence:
      'All five Constraints C1-C5 covered in tests and/or contract surface. C1: scribe.summary cache-keyed by (subject, date), test "generates and caches on miss when summarizer configured" verifies one generation per key. C2: file-backend writes <root>/<YYYY-MM-DD>.jsonl, test "rotates files by UTC day". C3: MCP server uses @modelcontextprotocol/sdk standard handlers (ListToolsRequestSchema, CallToolRequestSchema). C4: TypeScript reference, tsconfig strict, no mixed-language code. C5: publisher does not inspect payloads; documented in publisher.ts JSDoc and README; obligation is upstream.',
  },
  {
    key: 'H3',
    status: 'held',
    evidence:
      'All six Services S1-S6 shipped with documented contracts: S1 createPublisher (publisher/publisher.ts) + 9 tests; S2 createSubscriber (subscriber/subscriber.ts) + 7 tests; S3 scribe.query (mcp-server.ts) + integration test; S4 scribe.tail (mcp-server.ts) + tests; S5 scribe.summary (mcp-server.ts) with cache + summarizer + tests; S6 ScribeBackend protocol (backend-protocol.ts) + file-backend reference + 17 file-backend tests. No silent additions or removals. Signatures match the SIG Contract nodes.',
  },
  {
    key: 'H4',
    status: 'partial',
    evidence:
      'Pr1 (Scribe boot -> subscribe -> record) ran end-to-end in the integration test "publish -> Scribe captures -> query returns the event (H5)". Pr2 (daily summary) wiring verified by scribe.test.ts "runs the daily summary when scheduler fires" with an injected fake scheduler; the production setInterval-based scheduler is NOT exercised (no full-day integration run during the build). Partial: Pr1 fully verified, Pr2 wiring verified, Pr2 production cadence untested.',
  },
  {
    key: 'H5',
    status: 'held',
    evidence:
      'file-backend.test.ts "write -> query returns the canonical ScribeEvent exactly (DO1 round-trip)" verifies every field of DO1 (id, subject, publishedAt, publisherId, payload, correlationId) round-trips byte-equal. Integration test "publish -> Scribe captures -> query returns the event" verifies the full publish -> NATS -> Scribe -> file backend -> query round-trip end-to-end. DO2 SubjectFilter semantics verified by 4 subjectMatches tests.',
  },
  {
    key: 'H6',
    status: 'untested',
    evidence:
      'Stage 2d (SI/I adopts events-spine) has not run yet. H6 remains untested until the first real adoption consumes events-spine.',
  },
  {
    key: 'H7',
    status: 'untested',
    evidence:
      'Stage 2d wall-clock cannot be measured until Stage 2d runs. Note: events-spine reference-impl build itself ran in ~85 minutes wall-clock against a 4-6h cap, consistent with the recipe-file methodology over-performing by 2-3x (per simple-auth right-bookend §Surprise 1).',
  },
];

async function main(): Promise<void> {
  console.log(`[writeback] namespace=${NAMESPACE} graph=${GRAPH_URL}`);
  const driver = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  const session = driver.session();
  try {
    let updated = 0;
    let missing = 0;
    for (const u of UPDATES) {
      const result = await session.run(
        `
          MATCH (c:Contract {archetypeName: 'events-spine', namespace: $namespace})
            -[:DECLARES_HYPOTHESIS]->(h:Hypothesis {key: $key, namespace: $namespace})
          SET h.status = $status,
              h.evidence = $evidence,
              h.verifiedAt = datetime()
          RETURN h.key AS key, h.status AS status
        `,
        {
          namespace: NAMESPACE,
          key: u.key,
          status: u.status,
          evidence: u.evidence,
        },
      );
      if (result.records.length === 0) {
        console.warn(`[writeback]   ${u.key}: NOT FOUND in graph`);
        missing++;
      } else {
        const r = result.records[0];
        console.log(`[writeback]   ${r.get('key')} -> ${r.get('status')}`);
        updated++;
      }
    }
    console.log(`[writeback] done. updated=${updated} missing=${missing}`);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error('[writeback] failed:', err);
  process.exit(1);
});
