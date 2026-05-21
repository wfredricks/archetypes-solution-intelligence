/**
 * Verifies the asi SIG is reachable from the workspace and contains the
 * Solution root.
 *
 * // Why: graph-client/ is a scaffold (its body lands in upstream Stage 3
 * // and arrives here via a future refresh). Until then, this script
 * // talks to PolyGraph directly via neo4j-driver so the boot-check has
 * // something concrete to assert against.
 *
 * Usage: npx tsx scripts/verify-graph.ts
 *
 * @module scripts/verify-graph
 */

import neo4j from 'neo4j-driver';

const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';

async function main(): Promise<void> {
  const driver = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  try {
    const session = driver.session();
    try {
      const res = await session.run(
        `MATCH (s:Solution {adoptionId: $adoptionId})
         RETURN s.name AS name, s.namespace AS namespace,
                s.cliBinary AS cliBinary, s.identityHttpPort AS port,
                s.adoptionVersion AS adoptionVersion,
                s.composes_identity AS composes_identity,
                s.composes_auditLedger AS composes_auditLedger,
                s.composes_eventing AS composes_eventing,
                s.composes_graph AS composes_graph`,
        { adoptionId: 'asi' },
      );
      if (res.records.length !== 1) {
        throw new Error(
          `expected exactly 1 Solution node for adoptionId=asi, got ${res.records.length}; run scripts/seed-solution.ts first`,
        );
      }
      const r = res.records[0];
      console.log('[verify] asi Solution root reachable:');
      console.log(`  name              = ${r.get('name')}`);
      console.log(`  namespace         = ${r.get('namespace')}`);
      console.log(`  cliBinary         = ${r.get('cliBinary')}`);
      console.log(`  identityHttpPort  = ${r.get('port').toNumber?.() ?? r.get('port')}`);
      console.log(`  adoptionVersion   = ${r.get('adoptionVersion')}`);
      console.log(`  composes:identity = ${r.get('composes_identity')}`);
      console.log(`  composes:audit    = ${r.get('composes_auditLedger')}`);
      console.log(`  composes:eventing = ${r.get('composes_eventing')}`);
      console.log(`  composes:graph    = ${r.get('composes_graph')}`);
      console.log('[verify] OK');
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('[verify] FAILED:', err.message ?? err);
  process.exitCode = 1;
});
