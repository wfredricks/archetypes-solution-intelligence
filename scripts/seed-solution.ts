/**
 * Provenance:
 *   Phase 3a-revised refresh (2026-05-22) per
 *   BUILD-PHASE-3A-REVISED-PLAN.md §3a-pre.1. Lifts the
 *   backend-selection pattern from the contract-loader
 *   (Phase 1e: `backends/select.ts` + `BackendOptions`). The script is
 *   now backend-pluggable on env vars: defaults to Neo4j for asi
 *   (preserving prior behavior against constellation-neo4j) and accepts
 *   `SI_BACKEND=polygraph` + `SI_POLYGRAPH_PATH=<dir>` for adopters who
 *   route to embedded PolyGraph.
 *
 *   Ownership: asi-local. Mirrored to
 *   archetypes/solution-intel/reference-impl/scripts/seed-solution.ts
 *   (templated with `@adopt:` markers) at the same phase.
 */

/**
 * Seeds the asi adoption's Solution Intelligence Graph (SIG) root node.
 *
 * // Why: Task 2 (BUILD-ARCHETYPES-SI-ADOPTION-PLAN.md, Phase E) of the
 * // SIG-first pivot needs a clean, idempotent way to anchor every future
 * // contract in the asi SIG. That anchor is a single `Solution` node
 * // tagged with `adoptionId: "asi"`. Every subsequent node loaded into
 * // this SIG hangs off this root.
 *
 * // What it does:
 * //   1. Resolves the backend (Neo4j or PolyGraph) from env vars
 * //      following the same precedence as contract-loader's
 * //      `selectBackend()`. The selectBackend() call is also a
 * //      connectivity probe — it fails fast if the Bolt URL is
 * //      unreachable or the leveldb path is unwritable.
 * //   2. Idempotently clears prior namespace-tagged Solution nodes
 * //      (`MATCH (n:Solution {adoptionId}) DETACH DELETE n`).
 * //      Scoped to the `Solution` label so /code-ontology nodes
 * //      sharing the namespace are not affected.
 * //   3. Creates the Solution root node with the adoption profile
 * //      properties.
 * //   4. Verifies the seed by reading back the node count + key props.
 *
 * // Why bypass selectBackend() for the writes: the backend surface
 * // (Backend.query / Backend.native) exposes the patterns
 * // contract-loader needs — Pattern A wipe is restricted to
 * // contract-loader's label set, and the seed's CREATE+RETURN
 * // pattern is not one of the four write patterns the backend
 * // recognizes. selectBackend() is used here as a connectivity
 * // probe; the actual writes go through neo4j-driver (for Neo4j)
 * // or polygraph-db directly (for PolyGraph). The
 * // contract-loader/src/ surface stays untouched.
 *
 * // Idempotent: re-running the script wipes the namespace's
 * // Solution node(s) cleanly and reseeds. Other namespaces are
 * // untouched.
 *
 * Usage:
 *   npx tsx scripts/seed-solution.ts
 *
 * Env vars (precedence: SI_* > legacy ASI_*; both supported during
 * the asi → solution-intel name transition):
 *   SI_BACKEND          'neo4j' | 'polygraph'   (default 'neo4j')
 *   SI_POLYGRAPH_PATH   leveldb directory       (required when SI_BACKEND=polygraph)
 *   SI_NAMESPACE        Solution-root namespace (default 'asi')
 *   SI_GRAPH_URL        Bolt URL                (Neo4j only)
 *   SI_GRAPH_USER       Auth user               (Neo4j only)
 *   SI_GRAPH_PASS       Auth password           (Neo4j only)
 *
 * @module scripts/seed-solution
 */

import neo4j from 'neo4j-driver';

import { selectBackend } from '../contract-loader/src/backends/select.js';
import type { BackendOptions } from '../contract-loader/src/backends/types.js';

// ─── Adoption profile (the asi answers from BUILD-ARCHETYPES-SI-ADOPTION-PLAN.md) ──

const ADOPTION_ID = 'asi';
const SOLUTION_NAME = 'Archetypes';
const SOLUTION_TITLE = 'Archetypes Solution Intel';
const CLI_BINARY = 'asi';
const API_PREFIX = '/asi';
const IDENTITY_HTTP_PORT = 3101;
const ENV_VAR_PREFIX = 'ASI';
const DEFAULT_CONFIG_PATH = '~/.asi/';
const PACKAGE_SCOPE = '@asi';
const ADOPTED_AT = '2026-05-21T13:42:00-04:00';
const ADOPTION_VERSION = 'solution-intel@solution-intel-reference-impl-2026-05-21';
const COMPOSES_IDENTITY = 'simple-auth';
const COMPOSES_AUDIT_LEDGER = 'simple-ledger';
const COMPOSES_EVENTING = 'events-spine';
const COMPOSES_GRAPH = 'graph-db';

// ─── Connection (env-var driven, mirrors load-contracts.ts) ──────────────────

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

/**
 * Builds the Solution-node payload. Shared between the Neo4j and
 * PolyGraph paths so both backends write the same property set.
 */
function buildSolutionProperties(): Record<string, unknown> {
  return {
    name: SOLUTION_NAME,
    title: SOLUTION_TITLE,
    namespace: NAMESPACE,
    adoptionId: ADOPTION_ID,
    adoptedAt: ADOPTED_AT,
    adoptionVersion: ADOPTION_VERSION,
    composes_identity: COMPOSES_IDENTITY,
    composes_auditLedger: COMPOSES_AUDIT_LEDGER,
    composes_eventing: COMPOSES_EVENTING,
    composes_graph: COMPOSES_GRAPH,
    cliBinary: CLI_BINARY,
    apiPrefix: API_PREFIX,
    identityHttpPort: IDENTITY_HTTP_PORT,
    envVarPrefix: ENV_VAR_PREFIX,
    defaultConfigPath: DEFAULT_CONFIG_PATH,
    packageScope: PACKAGE_SCOPE,
  };
}

async function seedNeo4j(): Promise<void> {
  const driver = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  try {
    // 1) Connectivity check.
    const session1 = driver.session();
    try {
      const probe = await session1.run('RETURN 1 AS ok');
      const ok = probe.records[0]?.get('ok');
      if (ok === undefined) {
        throw new Error('connectivity probe returned no row');
      }
      console.log(`[seed] connected to ${GRAPH_URL} (probe=${ok})`);
    } finally {
      await session1.close();
    }

    // 2) Idempotent clear of the namespace's Solution node(s).
    const session2 = driver.session();
    try {
      const beforeRes = await session2.run(
        'MATCH (n:Solution {adoptionId: $adoptionId}) RETURN count(n) AS c',
        { adoptionId: ADOPTION_ID },
      );
      const before = beforeRes.records[0]?.get('c').toNumber?.() ?? 0;
      if (before > 0) {
        console.log(`[seed] clearing ${before} prior Solution node(s) for namespace="${NAMESPACE}"`);
        await session2.run(
          'MATCH (n:Solution {adoptionId: $adoptionId}) DETACH DELETE n',
          { adoptionId: ADOPTION_ID },
        );
      } else {
        console.log(`[seed] no prior Solution nodes for namespace="${NAMESPACE}" (clean install)`);
      }
    } finally {
      await session2.close();
    }

    // 3) Seed the Solution root.
    const session3 = driver.session();
    try {
      const props = buildSolutionProperties();
      const seedRes = await session3.run(
        `CREATE (s:Solution {
           name: $name,
           title: $title,
           namespace: $namespace,
           adoptionId: $adoptionId,
           adoptedAt: datetime($adoptedAt),
           adoptionVersion: $adoptionVersion,
           composes_identity: $composes_identity,
           composes_auditLedger: $composes_auditLedger,
           composes_eventing: $composes_eventing,
           composes_graph: $composes_graph,
           cliBinary: $cliBinary,
           apiPrefix: $apiPrefix,
           identityHttpPort: $identityHttpPort,
           envVarPrefix: $envVarPrefix,
           defaultConfigPath: $defaultConfigPath,
           packageScope: $packageScope
         })
         RETURN s.name AS name, s.namespace AS namespace`,
        {
          ...props,
          identityHttpPort: neo4j.int(IDENTITY_HTTP_PORT),
        },
      );
      const row = seedRes.records[0];
      console.log(
        `[seed] created Solution root: name="${row.get('name')}" namespace="${row.get('namespace')}"`,
      );
    } finally {
      await session3.close();
    }

    // 4) Verify.
    const session4 = driver.session();
    try {
      const verifyRes = await session4.run(
        'MATCH (s:Solution {adoptionId: $adoptionId}) RETURN count(s) AS c, collect(s.name)[0] AS name, collect(s.namespace)[0] AS namespace',
        { adoptionId: ADOPTION_ID },
      );
      const c = verifyRes.records[0]?.get('c').toNumber?.() ?? 0;
      const name = verifyRes.records[0]?.get('name');
      const namespace = verifyRes.records[0]?.get('namespace');
      console.log(`[seed] verify: ${c} Solution node(s); name="${name}" namespace="${namespace}"`);
      if (c !== 1) throw new Error(`expected exactly 1 Solution node, got ${c}`);
      if (name !== SOLUTION_NAME) throw new Error(`expected name="${SOLUTION_NAME}", got "${name}"`);
      if (namespace !== NAMESPACE) {
        throw new Error(`expected namespace="${NAMESPACE}", got "${namespace}"`);
      }
    } finally {
      await session4.close();
    }
  } finally {
    await driver.close();
  }
}

async function seedPolyGraph(): Promise<void> {
  if (!POLYGRAPH_PATH) {
    throw new Error(
      'SI_BACKEND=polygraph requires SI_POLYGRAPH_PATH (a leveldb directory)',
    );
  }
  // // Why dynamic import: polygraph-db is not a top-level dep of
  // // archetypes-solution-intelligence (it lives transitively under
  // // contract-loader/agents subpackages). The dynamic import keeps
  // // the neo4j-default path importable on a node_modules that has
  // // not hoisted polygraph-db. Adopters whose top-level package.json
  // // includes polygraph-db (e.g. stores) get the same resolution
  // // for free.
  const { LevelAdapter, PolyGraph } = await import('polygraph-db');
  const adapter = new LevelAdapter({ path: POLYGRAPH_PATH });
  const graph = new PolyGraph({ adapter });
  await graph.open();
  try {
    console.log(`[seed] connected to PolyGraph at ${POLYGRAPH_PATH}`);

    // 2) Idempotent clear of the namespace's Solution node(s).
    //    Scoped to the `Solution` label so /code-ontology nodes
    //    sharing the namespace tag are not affected.
    const existing = await graph.findNodes('Solution', { adoptionId: ADOPTION_ID });
    if (existing.length > 0) {
      console.log(`[seed] clearing ${existing.length} prior Solution node(s) for namespace="${NAMESPACE}"`);
      for (const n of existing) {
        await graph.deleteNode(n.id);
      }
    } else {
      console.log(`[seed] no prior Solution nodes for namespace="${NAMESPACE}" (clean install)`);
    }

    // 3) Seed the Solution root.
    //    PolyGraph stores properties as-is; we mirror Neo4j's
    //    `datetime()` by storing the ISO string verbatim. Consumers
    //    of `adoptedAt` parse with Date(...). identityHttpPort is a
    //    plain JS number (no neo4j.int wrapper needed).
    const props = buildSolutionProperties();
    const created = await graph.createNode(['Solution'], props);
    console.log(
      `[seed] created Solution root: name="${(created.properties as Record<string, unknown>).name}" namespace="${(created.properties as Record<string, unknown>).namespace}"`,
    );

    // 4) Verify.
    const verify = await graph.findNodes('Solution', { adoptionId: ADOPTION_ID });
    if (verify.length !== 1) throw new Error(`expected exactly 1 Solution node, got ${verify.length}`);
    const got = verify[0].properties as Record<string, unknown>;
    if (got.name !== SOLUTION_NAME) throw new Error(`expected name="${SOLUTION_NAME}", got "${got.name}"`);
    if (got.namespace !== NAMESPACE) {
      throw new Error(`expected namespace="${NAMESPACE}", got "${got.namespace}"`);
    }
    console.log(`[seed] verify: 1 Solution node(s); name="${got.name}" namespace="${got.namespace}"`);
  } finally {
    await graph.close();
  }
}

async function main(): Promise<void> {
  // 1) Probe the backend via selectBackend() — same pattern as
  //    load-contracts.ts. Fails fast on unreachable Bolt URL or
  //    unwritable leveldb path. Closed immediately so the actual
  //    write path can reopen without leveldb-lock contention.
  const baseOptions: BackendOptions = {
    backend: BACKEND_KIND,
    graphUrl: GRAPH_URL,
    graphUser: GRAPH_USER,
    graphPass: GRAPH_PASS,
    polygraphPath: POLYGRAPH_PATH,
  };
  if (BACKEND_KIND === 'polygraph') {
    console.log(
      `[seed] namespace=${NAMESPACE} backend=polygraph path=${POLYGRAPH_PATH ?? '<unset>'}`,
    );
  } else {
    console.log(
      `[seed] namespace=${NAMESPACE} backend=neo4j graph=${GRAPH_URL}`,
    );
  }
  const probe = await selectBackend(baseOptions);
  await probe.close();

  if (BACKEND_KIND === 'polygraph') {
    await seedPolyGraph();
  } else {
    await seedNeo4j();
  }

  console.log('[seed] OK — SIG anchored');
}

main().catch((err) => {
  console.error('[seed] FAILED:', err.message ?? err);
  process.exitCode = 1;
});
