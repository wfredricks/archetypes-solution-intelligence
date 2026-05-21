/**
 * Round-trip test for commit + verify, against the live PolyGraph.
 *
 * // Why: The committer is the only path from in-memory ContractGraph to
 * // graph state. The contract for the committer is "what I write is
 * // what verifyContract reads back, idempotently across re-runs." This
 * // test pins both halves.
 *
 * // Test isolation: uses a synthetic namespace ("asi-test-contract-loader")
 * // and seeds its own Solution root so we never touch the operational
 * // `asi` namespace. The afterAll hook drops the namespace's entire
 * // subgraph to leave the live PolyGraph clean.
 *
 * // The test skips if PolyGraph is not reachable on the configured Bolt
 * // URL. This keeps `npm test` runnable in CI environments that don't
 * // run Neo4j.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neo4j, { type Driver } from 'neo4j-driver';

import { parseBookend } from '../src/parse-bookend.js';
import { commitContract, verifyContract } from '../src/commit-contract.js';

const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';
const TEST_NAMESPACE = 'asi-test-contract-loader';
const EVENTS_SPINE_BOOKEND =
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md';

let driver: Driver | null = null;
let polygraphReachable = false;

beforeAll(async () => {
  const d = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  try {
    const s = d.session();
    try {
      await s.run('RETURN 1');
      polygraphReachable = true;
    } finally {
      await s.close();
    }
    driver = d;
  } catch {
    polygraphReachable = false;
    await d.close();
    return;
  }

  // Seed a test-only Solution root we can anchor against.
  const session = driver.session();
  try {
    await session.run(`MATCH (n {namespace: $ns}) DETACH DELETE n`, { ns: TEST_NAMESPACE });
    await session.run(
      `CREATE (s:Solution {name: "TestArchetypes", namespace: $ns, adoptionId: $ns})`,
      { ns: TEST_NAMESPACE },
    );
  } finally {
    await session.close();
  }
});

afterAll(async () => {
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(`MATCH (n {namespace: $ns}) DETACH DELETE n`, { ns: TEST_NAMESPACE });
  } finally {
    await session.close();
  }
  await driver.close();
});

describe('commitContract — round-trip against live PolyGraph', () => {
  it('commits and verifies the events-spine contract', async () => {
    if (!polygraphReachable) {
      console.warn('[commit-contract.test] PolyGraph not reachable; skipping.');
      return;
    }
    const graph = parseBookend(EVENTS_SPINE_BOOKEND);
    const summary = await commitContract(graph, {
      namespace: TEST_NAMESPACE,
      graphUrl: GRAPH_URL,
      graphUser: GRAPH_USER,
      graphPass: GRAPH_PASS,
      driver: driver!,
    });
    expect(summary.contractId).toBe('events-spine-v0.1.0-pre');
    // 1 Contract + 5P + 5C + 6S + 2Pr + 2DO + 7H = 28 nodes
    expect(summary.nodeCount).toBe(28);
    // DECLARES_* edges: 5+5+6+2+2+7 = 27, + 1 HAS_CONTRACT = 28
    expect(summary.edgeCount).toBe(28);
    expect(summary.anchoredTo).toBe('TestArchetypes');

    const verify = await verifyContract(summary.contractId, TEST_NAMESPACE, {
      driver: driver!,
    });
    expect(verify.hasAnchor).toBe(true);
    // verify counts nodes tagged with contractId (excludes Solution)
    expect(verify.nodeCount).toBe(28);
  });

  it('is idempotent: re-commit leaves the same shape', async () => {
    if (!polygraphReachable) return;
    const graph = parseBookend(EVENTS_SPINE_BOOKEND);
    const first = await commitContract(graph, {
      namespace: TEST_NAMESPACE,
      driver: driver!,
    });
    const second = await commitContract(graph, {
      namespace: TEST_NAMESPACE,
      driver: driver!,
    });
    expect(second.nodeCount).toBe(first.nodeCount);
    expect(second.edgeCount).toBe(first.edgeCount);

    // Direct graph query: only ONE Contract node should exist for this
    // namespace + archetypeName.
    const session = driver!.session();
    try {
      const res = await session.run(
        `MATCH (c:Contract {archetypeName: 'events-spine', namespace: $ns}) RETURN count(c) AS c`,
        { ns: TEST_NAMESPACE },
      );
      expect(res.records[0].get('c').toNumber()).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('fails loudly if Solution root for namespace is missing', async () => {
    if (!polygraphReachable) return;
    const graph = parseBookend(EVENTS_SPINE_BOOKEND);
    await expect(
      commitContract(graph, {
        namespace: 'asi-test-no-such-solution',
        driver: driver!,
      }),
    ).rejects.toThrow(/no Solution node found/i);
  });
});
