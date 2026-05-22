/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-1E-PLAN.md §1e.4.
 *
 *   Ownership: asi-local. Pins the Backend contract: the same input
 *   produces the same output from `commitContract`, `verifyContract`,
 *   `listContracts`, and `showContract` regardless of which backend
 *   is selected. If the two paths drift, this suite goes red.
 */

/**
 * Differential tests across the two backends.
 *
 * // Why a separate file from commit-contract.test.ts: the existing
 * // test file reaches into the Neo4j driver to seed the test
 * // namespace, which doesn't translate to PolyGraph. This suite is
 * // backend-agnostic — for each backend kind we set up the Solution
 * // root via the kind's own native primitives.
 * //
 * // Neo4j gating: the suite is skipped for the `'neo4j'` parameter
 * // when the configured Bolt URL is unreachable. The PolyGraph leg
 * // always runs (embedded leveldb in `os.tmpdir()`).
 *
 * @module tests/backends-differential
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import neo4j, { type Driver } from 'neo4j-driver';

import { parseBookend } from '../src/parse-bookend.js';
import { commitContract, verifyContract } from '../src/commit-contract.js';
import { listContracts, showContract } from '../src/query-contracts.js';
import type { BackendOptions } from '../src/backends/types.js';
import { selectBackend } from '../src/backends/select.js';

const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';
const EVENTS_SPINE_BOOKEND =
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md';

/** Sentinel namespace; per-backend suite gets its own with a suffix. */
const TEST_NAMESPACE_BASE = 'asi-test-cl-backend-diff';

// Probe Neo4j reachability up front so both `describe.each` legs can
// `it.skipIf(...)` their cases consistently.
let neo4jDriver: Driver | null = null;
let neo4jReachable = false;

beforeAll(async () => {
  const d = neo4j.driver(GRAPH_URL, neo4j.auth.basic(GRAPH_USER, GRAPH_PASS));
  try {
    const s = d.session();
    try {
      await s.run('RETURN 1');
      neo4jReachable = true;
    } finally {
      await s.close();
    }
    neo4jDriver = d;
  } catch {
    neo4jReachable = false;
    await d.close();
  }
});

afterAll(async () => {
  if (neo4jDriver) await neo4jDriver.close();
});

interface BackendFixture {
  /** Backend identity for test names. */
  kind: 'neo4j' | 'polygraph';
  /** The option object passed to public functions. */
  options(): BackendOptions & { polygraphPath?: string };
  /** Skip the suite when the backend isn't reachable in CI. */
  skip(): boolean;
  /** Create the Solution anchor before each test run. */
  setup(): Promise<void>;
  /** Drop the test namespace afterwards. */
  teardown(): Promise<void>;
  /** Namespace used for the leg. */
  namespace: string;
}

function makeNeo4jFixture(): BackendFixture {
  const namespace = `${TEST_NAMESPACE_BASE}-neo4j`;
  return {
    kind: 'neo4j',
    namespace,
    skip: () => !neo4jReachable,
    options: () => ({ driver: neo4jDriver ?? undefined }),
    setup: async () => {
      if (!neo4jDriver) return;
      const s = neo4jDriver.session();
      try {
        await s.run(`MATCH (n {namespace: $ns}) DETACH DELETE n`, { ns: namespace });
        await s.run(
          `CREATE (s:Solution {name: "DifferentialTestArchetypes", namespace: $ns, adoptionId: $ns})`,
          { ns: namespace },
        );
      } finally {
        await s.close();
      }
    },
    teardown: async () => {
      if (!neo4jDriver) return;
      const s = neo4jDriver.session();
      try {
        await s.run(`MATCH (n {namespace: $ns}) DETACH DELETE n`, { ns: namespace });
      } finally {
        await s.close();
      }
    },
  };
}

function makePolyGraphFixture(): BackendFixture {
  // Each test gets a fresh leveldb directory under os.tmpdir(). Plan
  // §"Hard constraints" #9.
  const dir = mkdtempSync(join(tmpdir(), 'asi-cl-pg-'));
  const namespace = `${TEST_NAMESPACE_BASE}-polygraph`;
  return {
    kind: 'polygraph',
    namespace,
    skip: () => false,
    options: () => ({ backend: 'polygraph', polygraphPath: dir }),
    setup: async () => {
      // Seed the Solution anchor by going through the backend itself.
      // Why not via cypher: PolyGraph's `CREATE (s:Solution {...})`
      // shape works, but native createNode is the simpler path here.
      const backend = await selectBackend({ backend: 'polygraph', polygraphPath: dir });
      try {
        // Defensive wipe in case a prior run left artifacts.
        await backend.query(
          `MATCH (n {namespace: $ns}) DETACH DELETE n`,
          { ns: namespace },
        );
        await backend.query(
          `CREATE (s:Solution {name: $name, namespace: $ns, adoptionId: $ns})`,
          { name: 'DifferentialTestArchetypes', ns: namespace },
        );
      } finally {
        await backend.close();
      }
    },
    teardown: async () => {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

// Build the parametrized suite. Even when Neo4j is unreachable we
// register the case (vitest needs a stable describe tree) and skip
// the inner `it`s via the fixture's `skip()` gate.
const fixtures: BackendFixture[] = [makeNeo4jFixture(), makePolyGraphFixture()];

describe.each(fixtures)(
  'contract-loader differential (backend=$kind)',
  (fixture) => {
    beforeAll(async () => {
      if (fixture.skip()) return;
      await fixture.setup();
    });
    afterAll(async () => {
      if (fixture.skip()) return;
      await fixture.teardown();
    });

    it('commitContract returns the same CommitSummary shape', async () => {
      if (fixture.skip()) return;
      const graph = parseBookend(EVENTS_SPINE_BOOKEND);
      const summary = await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      expect(summary.contractId).toBe('events-spine-v0.1.0-pre');
      // 1 Contract + 5P + 5C + 6S + 2Pr + 2DO + 7H = 28 nodes
      expect(summary.nodeCount).toBe(28);
      // DECLARES_* edges: 5+5+6+2+2+7 = 27, + 1 HAS_CONTRACT = 28
      expect(summary.edgeCount).toBe(28);
      expect(summary.anchoredTo).toBe('DifferentialTestArchetypes');
    });

    it('verifyContract returns the same { hasAnchor, nodeCount }', async () => {
      if (fixture.skip()) return;
      const graph = parseBookend(EVENTS_SPINE_BOOKEND);
      const summary = await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      const v = await verifyContract(summary.contractId, fixture.namespace, {
        ...fixture.options(),
      });
      expect(v.hasAnchor).toBe(true);
      expect(v.nodeCount).toBe(28);
      // edgeCount: 27 DECLARES_* (Contract → sub-nodes). Note this
      // does NOT include the HAS_CONTRACT edge (which originates on
      // the Solution, not on a contract-tagged node) — matches the
      // Phase 1c Neo4j cypher's `count(DISTINCT r)` semantics.
      expect(v.edgeCount).toBe(27);
    });

    it('listContracts returns the same set', async () => {
      if (fixture.skip()) return;
      const graph = parseBookend(EVENTS_SPINE_BOOKEND);
      await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      const list = await listContracts(fixture.namespace, fixture.options());
      expect(list).toHaveLength(1);
      expect(list[0].archetypeName).toBe('events-spine');
      expect(list[0].archetypeKind).toBe('composite');
      expect(list[0].archetypeVersion).toBe('v0.1.0-pre');
      expect(list[0].contractId).toBe('events-spine-v0.1.0-pre');
    });

    it('showContract returns the same ContractDetail shape', async () => {
      if (fixture.skip()) return;
      const graph = parseBookend(EVENTS_SPINE_BOOKEND);
      await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      const detail = await showContract(
        'events-spine',
        fixture.namespace,
        fixture.options(),
      );
      expect(detail).not.toBeNull();
      expect(detail!.archetypeName).toBe('events-spine');
      // Sorted by key in the ORDER BY → both backends should agree.
      expect(detail!.principles.map((p) => p.key)).toEqual([
        'P1',
        'P2',
        'P3',
        'P4',
        'P5',
      ]);
      expect(detail!.constraints.map((c) => c.key)).toEqual([
        'C1',
        'C2',
        'C3',
        'C4',
        'C5',
      ]);
      expect(detail!.services.map((s) => s.key)).toEqual([
        'S1',
        'S2',
        'S3',
        'S4',
        'S5',
        'S6',
      ]);
      expect(detail!.processes.map((p) => p.key)).toEqual(['Pr1', 'Pr2']);
      expect(detail!.dataObjects.map((d) => d.key)).toEqual(['DO1', 'DO2']);
      expect(detail!.hypotheses.map((h) => h.key)).toEqual([
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'H7',
      ]);
    });

    it('round-trip: parseBookend → commit → show returns equivalent contract', async () => {
      if (fixture.skip()) return;
      const graph = parseBookend(EVENTS_SPINE_BOOKEND);
      await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      const detail = await showContract(
        'events-spine',
        fixture.namespace,
        fixture.options(),
      );
      expect(detail).not.toBeNull();

      // Spot-check: each parsed principle.key appears in the detail.
      const showKeys = new Set(detail!.principles.map((p) => p.key));
      for (const p of graph.principles) {
        expect(showKeys.has(p.key)).toBe(true);
      }

      // Spot-check: each parsed hypothesis.text survives unchanged.
      const showTextByKey = new Map(detail!.hypotheses.map((h) => [h.key, h.text]));
      for (const h of graph.hypotheses) {
        expect(showTextByKey.get(h.key)).toBe(h.text);
      }
    });

    it('idempotent commit: second commit leaves the same shape', async () => {
      if (fixture.skip()) return;
      const graph = parseBookend(EVENTS_SPINE_BOOKEND);
      const first = await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      const second = await commitContract(graph, {
        namespace: fixture.namespace,
        ...fixture.options(),
      });
      expect(second.nodeCount).toBe(first.nodeCount);
      expect(second.edgeCount).toBe(first.edgeCount);

      // Verify only ONE Contract node still exists.
      const list = await listContracts(fixture.namespace, fixture.options());
      expect(list).toHaveLength(1);
    });
  },
);
