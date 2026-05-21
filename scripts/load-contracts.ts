/**
 * Loads archetype contracts into the asi SIG.
 *
 * // Why: Task 3 (BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase F) makes the
 * // SIG+SDD+DSD loop operational. This script is the canonical bootstrap
 * // that drives `@asi/contract-loader` against the two LEFT-BOOKEND.md
 * // files we treat as contracts in v0.1.1-pre: events-spine and
 * // simple-auth. Re-running is safe: each commit is idempotent per
 * // contractId.
 *
 * // Usage:
 * //   npx tsx scripts/load-contracts.ts
 * //
 * // Override the bookend list via positional args (paths to
 * // LEFT-BOOKEND.md files):
 * //   npx tsx scripts/load-contracts.ts <path1> <path2> ...
 *
 * @module scripts/load-contracts
 */

import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';

import { parseBookend, commitContract } from '../contract-loader/src/index.js';

const NAMESPACE = process.env.ASI_NAMESPACE ?? 'asi';
const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';

const DEFAULT_BOOKENDS = [
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md',
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/simple-auth/LEFT-BOOKEND.md',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bookendPaths = (args.length > 0 ? args : DEFAULT_BOOKENDS).map((p) => resolve(p));

  console.log(`[load-contracts] namespace=${NAMESPACE} graph=${GRAPH_URL}`);
  console.log(`[load-contracts] loading ${bookendPaths.length} bookend(s)`);

  const driver = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  let totalNodes = 0;
  let totalEdges = 0;
  try {
    for (const path of bookendPaths) {
      console.log(`[load-contracts] parsing ${path}`);
      const graph = parseBookend(path);
      const summary = await commitContract(graph, {
        namespace: NAMESPACE,
        driver,
      });
      console.log(
        `[load-contracts]   committed ${summary.contractId}: ${summary.nodeCount} nodes, ${summary.edgeCount} edges (anchored to "${summary.anchoredTo}")`,
      );
      totalNodes += summary.nodeCount;
      totalEdges += summary.edgeCount;
    }

    // After all primary contracts are loaded, re-commit composites so
    // their COMPOSES edges to siblings can resolve.
    // (events-spine composes simple-pubsub/subscriber/scribe/mcp-proxy —
    //  none of which have Contract nodes yet, so this is a no-op for
    //  v0.1.1-pre. The shape is in place for v0.1.2-pre when those
    //  primitives' bookends land.)
    console.log(
      `[load-contracts] done: ${bookendPaths.length} contracts, ${totalNodes} nodes, ${totalEdges} edges`,
    );
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('[load-contracts] FAILED:', err.message ?? err);
  process.exitCode = 1;
});
