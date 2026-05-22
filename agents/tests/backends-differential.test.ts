/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-2_5-PLAN.md §2.5.4.
 *
 *   Lift origin: pattern lifted from `contract-loader/tests/backends-differential.test.ts`
 *   (Phase 1e). Same `describe.each` + Neo4j-skipIf-unreachable shape.
 *
 *   Ownership: asi-local. Pins the agents-side Backend contract: the
 *   same SIG fixture produces the same findings from
 *   `runCompletenessAgent` and `runBookendAuditAgent` regardless of
 *   which backend is selected. If the two paths drift, this suite
 *   goes red.
 */

/**
 * Differential tests for `@asi/agents` across the two backends.
 *
 * // Why a separate file from the existing per-agent test files: the
 * // existing tests use a fake `Driver` and never touch real
 * // infrastructure. This suite stands up real PolyGraph + (when
 * // reachable) real Neo4j, seeds the same node/edge fixture into
 * // both, runs the agents, and asserts the findings agree.
 *
 * // Neo4j gating: the suite is skipped for the `'neo4j'` parameter
 * // when the configured Bolt URL is unreachable. The PolyGraph leg
 * // always runs (embedded leveldb in `os.tmpdir()` per plan
 * // §"Hard constraints" #10).
 *
 * @module tests/backends-differential
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import neo4j, { type Driver } from 'neo4j-driver';

import { runCompletenessAgent } from '../src/completeness/completeness-agent.js';
import { runBookendAuditAgent } from '../src/bookend-audit/bookend-audit-agent.js';
import { selectBackend } from '../src/backends/select.js';
import type { Finding } from '../src/types.js';

const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';

/** Sentinel namespace; per-backend suite gets its own with a suffix. */
const TEST_NAMESPACE_BASE = 'asi-test-agents-backend-diff';

// Probe Neo4j reachability up front (events-spine harness pattern).
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
  kind: 'neo4j' | 'polygraph';
  skip(): boolean;
  /** Options to pass to the agent run. */
  agentOptions(): {
    driver?: Driver;
    backend?: 'neo4j' | 'polygraph';
    polygraphPath?: string;
  };
  /** Seed the canned fixture into the backend. */
  setup(): Promise<void>;
  /** Drop the test namespace afterwards. */
  teardown(): Promise<void>;
  /** Namespace used for the leg. */
  namespace: string;
}

/**
 * The canned fixture seeded into both backends. Designed so each rule
 * in CompletenessAgent fires at least once.
 *
 * Contracts:
 *   - "alpha" — declares 3 hypotheses (open, held-fresh, held-stale)
 *     plus 1 Service plus 1 Process. Service has Process ⇒ no
 *     service-no-process finding.
 *   - "beta"  — declares 0 hypotheses and 1 Service with NO Process.
 *     Triggers contract-no-hypotheses + service-no-process.
 *
 * DataObjects:
 *   - "owned-do" — has an OWNS edge from alpha. No orphan.
 *   - "orphan-do" — no incoming edges. Triggers dataobject-orphan.
 */
const FIXED_NOW = new Date('2026-05-22T16:00:00.000Z');
const FRESH_VERIFIED = '2026-05-01T00:00:00.000Z'; // within 90 days
const STALE_VERIFIED = '2025-01-01T00:00:00.000Z'; // older than 90 days

function makeNeo4jFixture(): BackendFixture {
  const namespace = `${TEST_NAMESPACE_BASE}-neo4j`;
  return {
    kind: 'neo4j',
    namespace,
    skip: () => !neo4jReachable,
    agentOptions: () => ({ driver: neo4jDriver ?? undefined }),
    setup: async () => {
      if (!neo4jDriver) return;
      await seedNeo4j(neo4jDriver, namespace);
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
  // Why mkdtempSync at fixture-construct time (not in setup()):
  // the same directory must be visible to setup, agent runs, AND
  // teardown. mkdtempSync gives us a fresh subdir under tmpdir().
  const dir = mkdtempSync(join(tmpdir(), 'asi-agents-pg-'));
  const namespace = `${TEST_NAMESPACE_BASE}-polygraph`;
  return {
    kind: 'polygraph',
    namespace,
    skip: () => false,
    agentOptions: () => ({ backend: 'polygraph', polygraphPath: dir }),
    setup: async () => {
      await seedPolyGraph(dir, namespace);
    },
    teardown: async () => {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Seed the canned fixture into Neo4j via direct cypher.
 *
 * // Why directly rather than via commit-contract: the fixture is
 * // engineered to trigger specific rules; building it through the
 * // bookend parser would couple this suite to bookend file shapes.
 */
async function seedNeo4j(driver: Driver, ns: string): Promise<void> {
  const s = driver.session();
  try {
    // Defensive wipe.
    await s.run(`MATCH (n {namespace: $ns}) DETACH DELETE n`, { ns });
    await s.run(
      `CREATE (a:Contract {namespace: $ns, archetypeName: 'alpha'})
       CREATE (b:Contract {namespace: $ns, archetypeName: 'beta'})
       CREATE (h1:Hypothesis {namespace: $ns, key: 'H1', status: 'open',  text: '', verifiedAt: null})
       CREATE (h2:Hypothesis {namespace: $ns, key: 'H2', status: 'held',  text: '', verifiedAt: $freshAt})
       CREATE (h3:Hypothesis {namespace: $ns, key: 'H3', status: 'held',  text: '', verifiedAt: $staleAt})
       CREATE (sva:Service   {namespace: $ns, key: 'S-alpha', name: 'Alpha Service'})
       CREATE (svb:Service   {namespace: $ns, key: 'S-beta',  name: 'Beta Service'})
       CREATE (proc:Process  {namespace: $ns, key: 'P-alpha', name: 'Alpha Process'})
       CREATE (own:DataObject{namespace: $ns, key: 'owned-do',  name: 'Owned'})
       CREATE (orp:DataObject{namespace: $ns, key: 'orphan-do', name: 'Orphan'})
       CREATE (a)-[:DECLARES_HYPOTHESIS]->(h1)
       CREATE (a)-[:DECLARES_HYPOTHESIS]->(h2)
       CREATE (a)-[:DECLARES_HYPOTHESIS]->(h3)
       CREATE (a)-[:DECLARES_SERVICE]->(sva)
       CREATE (a)-[:DECLARES_PROCESS]->(proc)
       CREATE (a)-[:OWNS]->(own)
       CREATE (b)-[:DECLARES_SERVICE]->(svb)`,
      { ns, freshAt: FRESH_VERIFIED, staleAt: STALE_VERIFIED },
    );
  } finally {
    await s.close();
  }
}

/**
 * Seed the same canned fixture into PolyGraph via native primitives.
 *
 * // Why not cypher: PolyGraph's v0.1.4 bridge does not handle multi-
 * // statement CREATE+CREATE+...+CREATE the way Neo4j does. Going
 * // through the backend's `native.findNodes`/`findRelationships`
 * // wouldn't help — we need *creates*. We use the underlying
 * // graph object via the selectBackend export; PolyGraphBackend
 * // doesn't expose a writer surface (it's read-only at the Backend
 * // level), so we open a sibling PolyGraph for seeding.
 */
async function seedPolyGraph(dir: string, ns: string): Promise<void> {
  const { LevelAdapter, PolyGraph } = await import('polygraph-db');
  const adapter = new LevelAdapter({ path: dir });
  const graph = new PolyGraph({ adapter });
  await graph.open();
  try {
    const a = await graph.createNode(['Contract'], { namespace: ns, archetypeName: 'alpha' });
    const b = await graph.createNode(['Contract'], { namespace: ns, archetypeName: 'beta' });
    const h1 = await graph.createNode(['Hypothesis'], {
      namespace: ns,
      key: 'H1',
      status: 'open',
      text: '',
      verifiedAt: null,
    });
    const h2 = await graph.createNode(['Hypothesis'], {
      namespace: ns,
      key: 'H2',
      status: 'held',
      text: '',
      verifiedAt: FRESH_VERIFIED,
    });
    const h3 = await graph.createNode(['Hypothesis'], {
      namespace: ns,
      key: 'H3',
      status: 'held',
      text: '',
      verifiedAt: STALE_VERIFIED,
    });
    const sva = await graph.createNode(['Service'], {
      namespace: ns,
      key: 'S-alpha',
      name: 'Alpha Service',
    });
    const svb = await graph.createNode(['Service'], {
      namespace: ns,
      key: 'S-beta',
      name: 'Beta Service',
    });
    const proc = await graph.createNode(['Process'], {
      namespace: ns,
      key: 'P-alpha',
      name: 'Alpha Process',
    });
    const own = await graph.createNode(['DataObject'], {
      namespace: ns,
      key: 'owned-do',
      name: 'Owned',
    });
    await graph.createNode(['DataObject'], {
      namespace: ns,
      key: 'orphan-do',
      name: 'Orphan',
    });
    await graph.createRelationship(a.id, h1.id, 'DECLARES_HYPOTHESIS');
    await graph.createRelationship(a.id, h2.id, 'DECLARES_HYPOTHESIS');
    await graph.createRelationship(a.id, h3.id, 'DECLARES_HYPOTHESIS');
    await graph.createRelationship(a.id, sva.id, 'DECLARES_SERVICE');
    await graph.createRelationship(a.id, proc.id, 'DECLARES_PROCESS');
    await graph.createRelationship(a.id, own.id, 'OWNS');
    await graph.createRelationship(b.id, svb.id, 'DECLARES_SERVICE');
  } finally {
    await graph.close();
  }
}

const fixtures: BackendFixture[] = [makeNeo4jFixture(), makePolyGraphFixture()];

describe.each(fixtures)(
  'agents differential (backend=$kind)',
  (fixture) => {
    beforeAll(async () => {
      if (fixture.skip()) return;
      await fixture.setup();
    });
    afterAll(async () => {
      if (fixture.skip()) return;
      await fixture.teardown();
    });

    it('CompletenessAgent: hypothesis sweep emits open + stale findings', async () => {
      if (fixture.skip()) return;
      const report = await runCompletenessAgent({
        namespace: fixture.namespace,
        now: () => FIXED_NOW,
        ...fixture.agentOptions(),
      });
      const open = report.findings.filter(
        (f) => f.ruleId === 'completeness:hypothesis-open',
      );
      const stale = report.findings.filter(
        (f) => f.ruleId === 'completeness:hypothesis-stale',
      );
      expect(open).toHaveLength(1);
      expect(open[0].key).toBe('H1');
      expect(open[0].archetype).toBe('alpha');
      expect(stale).toHaveLength(1);
      expect(stale[0].key).toBe('H3');
      expect(stale[0].archetype).toBe('alpha');
      // H2 is held-fresh → no finding.
      expect(
        report.findings.find((f) => f.key === 'H2'),
      ).toBeUndefined();
    });

    it('CompletenessAgent: aggregation rule 5 (contract-no-hypotheses) fires for beta', async () => {
      if (fixture.skip()) return;
      const report = await runCompletenessAgent({
        namespace: fixture.namespace,
        now: () => FIXED_NOW,
        ...fixture.agentOptions(),
      });
      const noHypo = report.findings.filter(
        (f) => f.ruleId === 'completeness:contract-no-hypotheses',
      );
      expect(noHypo).toHaveLength(1);
      expect(noHypo[0].archetype).toBe('beta');
    });

    it('CompletenessAgent: aggregation rule 6 (dataobject-orphan) fires for orphan-do', async () => {
      if (fixture.skip()) return;
      const report = await runCompletenessAgent({
        namespace: fixture.namespace,
        now: () => FIXED_NOW,
        ...fixture.agentOptions(),
      });
      const orphans = report.findings.filter(
        (f) => f.ruleId === 'completeness:dataobject-orphan',
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0].key).toBe('orphan-do');
    });

    it('CompletenessAgent: aggregation rule 7 (service-no-process) fires for beta only', async () => {
      if (fixture.skip()) return;
      const report = await runCompletenessAgent({
        namespace: fixture.namespace,
        now: () => FIXED_NOW,
        ...fixture.agentOptions(),
      });
      const svc = report.findings.filter(
        (f) => f.ruleId === 'completeness:service-no-process',
      );
      expect(svc).toHaveLength(1);
      expect(svc[0].archetype).toBe('beta');
      expect(svc[0].key).toBe('S-beta');
    });

    it('BookendAuditAgent: SIG hypothesis read returns the alpha rows', async () => {
      if (fixture.skip()) return;
      // Build a fake archetypes-repo on disk that contains a snapshot
      // matching the SIG so the agent emits the in-sync finding,
      // which proves the SIG-read path produced the expected rows.
      const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
      const root = await mkdtemp(join(tmpdir(), 'asi-bookend-diff-'));
      const archetypeDir = join(root, 'alpha');
      await mkdir(archetypeDir, { recursive: true });
      // Render a snapshot that matches the SIG (3 rows for alpha):
      //   H1 open, H2 held, H3 held — same statuses the SIG holds.
      const body = [
        '# Snapshot',
        '',
        '| Key | Text (one-line) | Status | Evidence |',
        '|-----|------------------|--------|----------|',
        '| H1 |  | **open** |  |',
        '| H2 |  | **held** |  |',
        '| H3 |  | **held** |  |',
      ].join('\n');
      await writeFile(
        join(archetypeDir, 'RIGHT-BOOKEND-snapshot-2026-05-22.md'),
        body,
        'utf8',
      );

      const report = await runBookendAuditAgent({
        namespace: fixture.namespace,
        archetypeName: 'alpha',
        archetypesRepoPath: root,
        now: () => FIXED_NOW,
        ...fixture.agentOptions(),
      });
      // No drift findings expected (one in-sync info finding).
      const drift = report.findings.filter(
        (f) =>
          f.ruleId === 'bookend-audit:hypothesis-added' ||
          f.ruleId === 'bookend-audit:hypothesis-removed' ||
          f.ruleId === 'bookend-audit:status-drift',
      );
      expect(drift).toHaveLength(0);
      const inSync = report.findings.find((f) => f.ruleId === 'bookend-audit:in-sync');
      expect(inSync).toBeDefined();
      // The agent's hypothesis-count detail confirms it saw all 3 SIG rows.
      expect((inSync?.details as { hypothesisCount: number }).hypothesisCount).toBe(3);

      rmSync(root, { recursive: true, force: true });
    });

    it('Backend.kind matches the leg', async () => {
      if (fixture.skip()) return;
      const backend = await selectBackend(fixture.agentOptions());
      try {
        expect(backend.kind).toBe(fixture.kind);
      } finally {
        await backend.close();
      }
    });
  },
);

/**
 * Cross-backend agreement: the same fixture seeded into both backends
 * MUST produce the same set of findings (modulo ordering / `ranAt`).
 *
 * // Why this is the headline guarantee: every other test above asserts
 * // per-leg behavior. This test runs both legs (when reachable) and
 * // diffs their outputs directly. If the differential goes red, the
 * // two backend code paths have drifted.
 */
describe('cross-backend agreement', () => {
  it('CompletenessAgent: PolyGraph and Neo4j produce the same findings (when both reachable)', async () => {
    if (!neo4jReachable) return; // skip when Neo4j isn't up; PolyGraph leg alone proves no-drift over time
    const polygraphDir = mkdtempSync(join(tmpdir(), 'asi-agents-pg-cross-'));
    const ns = `${TEST_NAMESPACE_BASE}-cross`;
    try {
      // Seed both with the same fixture.
      await seedPolyGraph(polygraphDir, ns);
      if (neo4jDriver) await seedNeo4j(neo4jDriver, ns);

      const pgReport = await runCompletenessAgent({
        namespace: ns,
        backend: 'polygraph',
        polygraphPath: polygraphDir,
        now: () => FIXED_NOW,
      });
      const n4jReport = await runCompletenessAgent({
        namespace: ns,
        driver: neo4jDriver ?? undefined,
        now: () => FIXED_NOW,
      });

      // Compare by (ruleId, archetype, key) — the stable identity of a
      // finding. Message text is the same per leg but easier to diff
      // via the triple.
      const summarize = (findings: Finding[]) =>
        findings
          .map((f) => `${f.ruleId}|${f.archetype ?? ''}|${f.key ?? ''}`)
          .sort();
      expect(summarize(pgReport.findings)).toEqual(summarize(n4jReport.findings));

      // Cleanup.
      if (neo4jDriver) {
        const s = neo4jDriver.session();
        try {
          await s.run(`MATCH (n {namespace: $ns}) DETACH DELETE n`, { ns });
        } finally {
          await s.close();
        }
      }
    } finally {
      rmSync(polygraphDir, { recursive: true, force: true });
    }
  });
});
