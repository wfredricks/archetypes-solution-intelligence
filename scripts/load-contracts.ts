/**
 * Provenance:
 *   Phase 3a refresh (2026-05-22) per BUILD-PHASE-3A-PLAN.md §3a.1.
 *   Lifted the backend-selection pattern from the contract-loader
 *   (Phase 1e: `backends/select.ts` + `BackendOptions`). The script is
 *   now backend-pluggable on env vars: defaults to Neo4j for asi
 *   (preserving prior behavior against constellation-neo4j) and accepts
 *   `SI_BACKEND=polygraph` + `SI_POLYGRAPH_PATH=<dir>` for adopters who
 *   route to embedded PolyGraph.
 *
 *   Ownership: asi-local. Mirrored to
 *   archetypes/solution-intel/reference-impl/scripts/load-contracts.ts
 *   (templated with `@adopt:` markers) at the same phase.
 */

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
 * // Why backend-pluggable: Phase 3a is the proof point that adopters
 * // who choose PolyGraph (no external Neo4j) can run the canonical
 * // contract loader unchanged. The kind selection follows the same
 * // env-var pattern `contract-loader/src/backends/select.ts` already
 * // documents, so callers of `commitContract` see no surface change.
 *
 * // Usage:
 * //   npx tsx scripts/load-contracts.ts
 * //
 * // Override the bookend list via positional args (paths to
 * // LEFT-BOOKEND.md files):
 * //   npx tsx scripts/load-contracts.ts <path1> <path2> ...
 * //
 * // Env vars (precedence: SI_* > legacy ASI_*; both supported during
 * // the asi → solution-intel name transition):
 * //   SI_BACKEND          'neo4j' | 'polygraph'   (default 'neo4j')
 * //   SI_POLYGRAPH_PATH   leveldb directory       (required when SI_BACKEND=polygraph)
 * //   SI_NAMESPACE        Solution-root namespace (default 'asi')
 * //   SI_GRAPH_URL        Bolt URL                (Neo4j only)
 * //   SI_GRAPH_USER       Auth user               (Neo4j only)
 * //   SI_GRAPH_PASS       Auth password           (Neo4j only)
 *
 * @module scripts/load-contracts
 */

import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';

import { parseBookend, commitContract } from '../contract-loader/src/index.js';
import { selectBackend } from '../contract-loader/src/backends/select.js';
import type { BackendOptions } from '../contract-loader/src/backends/types.js';

const NAMESPACE =
  process.env.SI_NAMESPACE ?? process.env.ASI_NAMESPACE ?? 'asi';
const BACKEND_KIND = ((): 'neo4j' | 'polygraph' => {
  const raw = (process.env.SI_BACKEND ?? '').toLowerCase();
  if (raw === 'polygraph') return 'polygraph';
  if (raw === 'neo4j') return 'neo4j';
  return 'neo4j';
})();
const POLYGRAPH_PATH = process.env.SI_POLYGRAPH_PATH;
const GRAPH_URL =
  process.env.SI_GRAPH_URL ?? process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER =
  process.env.SI_GRAPH_USER ?? process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS =
  process.env.SI_GRAPH_PASS ?? process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';

const DEFAULT_BOOKENDS = [
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md',
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/simple-auth/LEFT-BOOKEND.md',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bookendPaths = (args.length > 0 ? args : DEFAULT_BOOKENDS).map((p) => resolve(p));

  const baseOptions: BackendOptions = {
    backend: BACKEND_KIND,
    graphUrl: GRAPH_URL,
    graphUser: GRAPH_USER,
    graphPass: GRAPH_PASS,
    polygraphPath: POLYGRAPH_PATH,
  };

  if (BACKEND_KIND === 'polygraph') {
    console.log(
      `[load-contracts] namespace=${NAMESPACE} backend=polygraph path=${POLYGRAPH_PATH ?? '<unset>'}`,
    );
  } else {
    console.log(
      `[load-contracts] namespace=${NAMESPACE} backend=neo4j graph=${GRAPH_URL}`,
    );
  }
  console.log(`[load-contracts] loading ${bookendPaths.length} bookend(s)`);

  // // Why call selectBackend() up front: lifts the same Phase 1e
  // // selection rules the contract-loader uses internally, so a
  // // misconfigured PolyGraph path or unreachable Bolt URL fails fast
  // // before we start parsing bookends. We close immediately to release
  // // the leveldb lock (for PolyGraph) before commitContract reopens it.
  const probe = await selectBackend(baseOptions);
  await probe.close();

  // For Neo4j, build a single shared driver to avoid reconnecting per
  // contract (preserves the pre-Phase-3a driver-sharing perf). For
  // PolyGraph, each commitContract call opens and closes its own
  // leveldb instance (sequential — no lock contention).
  let driver: import('neo4j-driver').Driver | undefined;
  if (BACKEND_KIND === 'neo4j') {
    driver = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  }

  let totalNodes = 0;
  let totalEdges = 0;
  try {
    for (const path of bookendPaths) {
      console.log(`[load-contracts] parsing ${path}`);
      const graph = parseBookend(path);
      const summary = await commitContract(graph, {
        namespace: NAMESPACE,
        // For Neo4j: pass the shared driver (back-compat path).
        // For PolyGraph: pass backend kind + path; commitContract
        // selects PolyGraphBackend internally.
        ...(driver
          ? { driver }
          : {
              backend: BACKEND_KIND,
              polygraphPath: POLYGRAPH_PATH,
              graphUrl: GRAPH_URL,
              graphUser: GRAPH_USER,
              graphPass: GRAPH_PASS,
            }),
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
    if (driver) await driver.close();
  }
}

main().catch((err) => {
  console.error('[load-contracts] FAILED:', err.message ?? err);
  process.exitCode = 1;
});
