/**
 * Stage 2d writeback: update events-spine Hypothesis H6 and H7 in the
 * asi SIG from "untested" to their post-adoption status with evidence.
 *
 * Runs after Stage 2d (SI/I adopts events-spine) ships. Companion to
 * scripts/writeback-events-spine-hypotheses.ts (which set H1-H5 at
 * the events-spine build moment). This script ONLY touches H6 + H7;
 * H1-H5 are untouched.
 *
 * // Why: H6 + H7 can only be evaluated once a real adopter exists.
 * // SI/I is that first adopter (Stage 2d). Splitting the writeback
 * // into two scripts keeps the events-spine-internal hypotheses
 * // (H1-H5) separate from adopter-derived hypotheses (H6+H7) so the
 * // provenance of each evidence string is unambiguous.
 *
 * // Idempotency: same shape as writeback-events-spine-hypotheses.ts;
 * // re-running SETs the same status/evidence; verifiedAt advances to
 * // `now()` on every run, recording the most recent assertion.
 *
 * // Usage:
 * //   npx tsx scripts/writeback-events-spine-stage-2d.ts
 *
 * @module scripts/writeback-events-spine-stage-2d
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
    key: 'H6',
    status: 'held',
    evidence:
      'Stage 2d (solution-intelligence-identity v0.2.2-pre, branch stage-2d-events-spine-adoption) adopted events-spine via configuration-only customization. The reference-impl files at src/events/types.ts, src/events/publisher/publisher.ts, and src/events/publisher/index.ts were derived verbatim with provenance JSDoc headers (citing source commit 1b334abbb354fa89dd758225e960ce5f58dcf365 = tag events-spine-v0.1.0-pre); no archetype-owned code (class/type/function names, contract surface) was modified. Adopter-owned namespacing (subject prefix "si.identity", publisher id "solution-intelligence-identity") happens in src/events/si-publisher.ts \u2014 a new SI-owned composition file that wraps the events-spine publisher with constructor options and typed per-event methods (publishLoginCompleted, publishGrantRecorded, publishRevokeRecorded) plus graceful-no-op semantics on NATS unavailability. events-spine carries no @adopt: markers (primitive composition; configured at runtime via constructor options); this validated the methodology stance that primitive composites adopt via composition, not source-file editing. 8 unit tests + 3 integration tests verify the adoption; all 70 pre-existing tests stayed green (post-adoption total: 81). Hypothesis HELD.',
  },
  {
    key: 'H7',
    status: 'held',
    evidence:
      'Stage 2d wall-clock: ~15 minutes from branch creation through PR open, well under the 4-hour cap and the 2.5-3.5-hour expected window in BUILD-STAGE-02D-PLAN.md. Consistent with the broader recipe-file-methodology pattern: simple-auth right-bookend §Surprise 1 documented 2-3\u00d7 over-performance; events-spine build itself was ~85 minutes against a 4-6h cap; Stage 2d continued the trend. Recipe-file methodology held for the first adoption to write back to an existing archetype\'s Hypothesis nodes. Hypothesis HELD.',
  },
];

async function main(): Promise<void> {
  console.log(`[stage-2d writeback] namespace=${NAMESPACE} graph=${GRAPH_URL}`);
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
        console.warn(`[stage-2d writeback]   ${u.key}: NOT FOUND in graph`);
        missing++;
      } else {
        const r = result.records[0];
        console.log(`[stage-2d writeback]   ${r.get('key')} -> ${r.get('status')}`);
        updated++;
      }
    }
    console.log(`[stage-2d writeback] done. updated=${updated} missing=${missing}`);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error('[stage-2d writeback] failed:', err);
  process.exit(1);
});
