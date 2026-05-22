/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.7.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"What the contract requires the
 *   substrate to grow" — surface #4: round-trip integrity test in CI.
 *
 *   Ownership: asi-local.
 */

/**
 * Round-trip integrity test for @asi/instance.
 *
 * The headline test of the package. Builds an in-memory PolyGraph
 * fixture (~20 nodes, ~30 edges, ~5 audit entries), exports it via
 * `exportInstance`, opens a SECOND in-memory PolyGraph, imports the
 * tarball into it via `importInstance`, and asserts:
 *
 *   - node counts match
 *   - edge counts match
 *   - audit entries match
 *   - node ids are preserved (PolyGraph honors createNode(_, _, id))
 *   - `instance.import.completed` event is present in the new ledger
 *   - re-exporting the round-tripped instance produces the SAME
 *     sigChecksum byte-for-byte (idempotency)
 *
 * The migrations catalog plumbing is also pinned here (empty catalog,
 * exact-version match returns no migrations).
 *
 * @module tests/roundtrip
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LevelAdapter, PolyGraph } from 'polygraph-db';

import {
  EXPORT_SCHEMA_VERSION,
  exportInstance,
  findMigrationChain,
  importInstance,
  migrations,
  readManifest,
} from '../src/index.js';

const TEST_NAMESPACE = 'asi-instance-roundtrip';
const SUBSTRATE_VERSION = '0.2.0-pre';
const INSTANCE_SCHEMA_VERSION = '0.2.0-pre';

interface Scratch {
  root: string;
  sourcePath: string;
  targetPath: string;
  exportPath: string;
  auditPath: string;
  grantsPath: string;
  targetAuditPath: string;
  targetGrantsPath: string;
}

let scratch: Scratch;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'asi-instance-roundtrip-'));
  scratch = {
    root,
    sourcePath: join(root, 'source-polygraph'),
    targetPath: join(root, 'target-polygraph'),
    exportPath: join(root, 'export.tar.gz'),
    auditPath: join(root, 'source-audit.jsonl'),
    grantsPath: join(root, 'source-grants.jsonl'),
    targetAuditPath: join(root, 'target-audit.jsonl'),
    targetGrantsPath: join(root, 'target-grants.jsonl'),
  };
});

afterEach(async () => {
  if (scratch?.root) {
    await rm(scratch.root, { recursive: true, force: true });
  }
});

/**
 * Build a fixture covering every label the canonical solution-intel
 * SIG uses, plus a few `/code` nodes for good measure. Anchored to
 * TEST_NAMESPACE so the round-trip is fully self-contained.
 */
async function buildSourceFixture(): Promise<{
  expectedNodes: number;
  expectedEdges: number;
}> {
  const adapter = new LevelAdapter({ path: scratch.sourcePath });
  const graph = new PolyGraph({ adapter });
  await graph.open();
  try {
    // Why pass an `id` for every node: pins the round-trip identity
    // contract on the PolyGraph path. The exporter writes whatever
    // PolyGraph returns; the importer hands it back to createNode.
    // Using stable readable ids keeps the test diagnostic.
    const solution = await graph.createNode(
      ['Solution'],
      {
        name: 'TEST-SOLUTION',
        namespace: TEST_NAMESPACE,
        adoptionId: TEST_NAMESPACE,
        adoptedAt: '2026-05-22T18:00:00-04:00',
        composes_identity: 'simple-auth',
      },
      'sol-1',
    );

    const contractA = await graph.createNode(
      ['Contract'],
      {
        archetypeName: 'events-spine',
        archetypeKind: 'composite',
        archetypeVersion: 'v0.1.0-pre',
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
        loadedAt: '2026-05-22T18:01:00-04:00',
        status: 'loaded',
      },
      'c-events',
    );
    const contractB = await graph.createNode(
      ['Contract'],
      {
        archetypeName: 'simple-auth',
        archetypeKind: 'primitive',
        archetypeVersion: 'lifted-2026-05-20',
        contractId: 'simple-auth-lifted-2026-05-20',
        namespace: TEST_NAMESPACE,
        loadedAt: '2026-05-22T18:02:00-04:00',
        status: 'loaded',
      },
      'c-auth',
    );

    const hypothesisA = await graph.createNode(
      ['Hypothesis'],
      {
        key: 'H1',
        text: 'events-spine survives operator restarts (open).',
        status: 'open',
        verifiedAt: null,
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
      },
      'h-1',
    );
    const hypothesisB = await graph.createNode(
      ['Hypothesis'],
      {
        key: 'H1',
        text: 'simple-auth gates writes.',
        status: 'held',
        verifiedAt: '2026-05-21T10:30:00-04:00',
        contractId: 'simple-auth-lifted-2026-05-20',
        namespace: TEST_NAMESPACE,
      },
      'h-2',
    );

    const principle = await graph.createNode(
      ['Principle'],
      {
        key: 'P1',
        name: 'append-only',
        driver: 'spine integrity (commas, "quotes", and other tricky chars)',
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
      },
      'p-1',
    );
    const constraint = await graph.createNode(
      ['Constraint'],
      {
        key: 'C1',
        name: 'no-rollback',
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
      },
      'co-1',
    );
    const service = await graph.createNode(
      ['Service'],
      {
        key: 'S1',
        name: 'Scribe',
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
      },
      's-1',
    );
    const process_ = await graph.createNode(
      ['Process'],
      {
        key: 'PR1',
        name: 'append-event',
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
      },
      'pr-1',
    );
    const dataObject = await graph.createNode(
      ['DataObject'],
      {
        key: 'D1',
        name: 'event',
        contractId: 'events-spine-v0.1.0-pre',
        namespace: TEST_NAMESPACE,
      },
      'd-1',
    );

    // A couple `/code` ontology nodes.
    const capability = await graph.createNode(
      ['Capability'],
      {
        name: 'auth.login',
        adoptionId: TEST_NAMESPACE,
      },
      'cap-1',
    );
    const businessRule = await graph.createNode(
      ['BusinessRule'],
      {
        name: 'BR.lockout-after-5',
        adoptionId: TEST_NAMESPACE,
      },
      'br-1',
    );
    const sourceFile = await graph.createNode(
      ['SourceFile'],
      {
        path: 'src/auth.ts',
        adoptionId: TEST_NAMESPACE,
      },
      'sf-1',
    );

    // Pad to ~20 nodes with a few extra Hypothesis/Principle to
    // exercise multi-row label ordering on the export.
    const extras: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = await graph.createNode(
        ['Hypothesis'],
        {
          key: `H${i + 2}`,
          text: `events-spine extra hypothesis ${i + 2}`,
          status: 'open',
          verifiedAt: null,
          contractId: 'events-spine-v0.1.0-pre',
          namespace: TEST_NAMESPACE,
        },
        `h-extra-${i}`,
      );
      extras.push(n.id);
    }

    // Edges — ~30 edges covering the contract ontology shape.
    await graph.createRelationship(solution.id, contractA.id, 'HAS_CONTRACT');
    await graph.createRelationship(solution.id, contractB.id, 'HAS_CONTRACT');
    await graph.createRelationship(contractA.id, hypothesisA.id, 'DECLARES_HYPOTHESIS');
    await graph.createRelationship(contractB.id, hypothesisB.id, 'DECLARES_HYPOTHESIS');
    await graph.createRelationship(contractA.id, principle.id, 'DECLARES_PRINCIPLE');
    await graph.createRelationship(contractA.id, constraint.id, 'DECLARES_CONSTRAINT');
    await graph.createRelationship(contractA.id, service.id, 'DECLARES_SERVICE');
    await graph.createRelationship(contractA.id, process_.id, 'DECLARES_PROCESS');
    await graph.createRelationship(contractA.id, dataObject.id, 'DECLARES_DATAOBJECT');
    await graph.createRelationship(service.id, process_.id, 'OWNS');
    await graph.createRelationship(process_.id, dataObject.id, 'PRODUCES');
    await graph.createRelationship(contractA.id, contractB.id, 'COMPOSES');

    // /code edges
    await graph.createRelationship(sourceFile.id, capability.id, 'IMPLEMENTS');
    await graph.createRelationship(capability.id, businessRule.id, 'HAS_BUSINESS_RULE');

    // Extra DECLARES_HYPOTHESIS edges from contractA to the padded
    // hypothesis nodes — gets us to ~26 edges total.
    for (const id of extras) {
      await graph.createRelationship(contractA.id, id, 'DECLARES_HYPOTHESIS');
    }

    // Count what we built (verifying against our manual tally).
    const allNodes = await graph.allNodes();
    return {
      expectedNodes: allNodes.length,
      // We created 12 + 6 = 18 named edges above + the extras count
      // (6 more from the loop). Total = 12 + 2 (/code) + 6 = 20.
      expectedEdges: 20,
    };
  } finally {
    await graph.close();
  }
}

describe('@asi/instance — round-trip integrity', () => {
  it('migrations catalog is empty by design (Phase 3 baseline)', () => {
    expect(migrations.length).toBe(0);
    // Exact-version match returns no migrations.
    expect(findMigrationChain('0.2.0-pre', '0.2.0-pre')).toEqual([]);
    // Mismatch throws an actionable error.
    expect(() => findMigrationChain('0.1.0-pre', '0.2.0-pre')).toThrow(
      /no migration registered/i,
    );
  });

  it('export schema version is pinned at 0.1.0', () => {
    expect(EXPORT_SCHEMA_VERSION).toBe('0.1.0');
  });

  it(
    'PolyGraph → tarball → PolyGraph preserves nodes, edges, and audit',
    async () => {
      const { expectedNodes, expectedEdges } = await buildSourceFixture();

      // Seed an audit ledger with ~5 events for the export to pick up.
      const auditEvents = [
        { eventType: 'instance.bootstrap', recordedAt: '2026-05-22T17:00:00-04:00' },
        { eventType: 'instance.contract.loaded', recordedAt: '2026-05-22T17:05:00-04:00' },
        { eventType: 'instance.hypothesis.opened', recordedAt: '2026-05-22T17:10:00-04:00' },
        { eventType: 'instance.hypothesis.held', recordedAt: '2026-05-22T17:15:00-04:00' },
        { eventType: 'si.identity.login.completed', recordedAt: '2026-05-22T17:20:00-04:00' },
      ];
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        scratch.auditPath,
        auditEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf8',
      );

      const grants = [
        { grantId: 'g1', subject: 'alice', role: 'admin', recordedAt: '2026-05-22T16:00:00-04:00' },
        { grantId: 'g2', subject: 'bob', role: 'reader', recordedAt: '2026-05-22T16:30:00-04:00' },
      ];
      await writeFile(
        scratch.grantsPath,
        grants.map((g) => JSON.stringify(g)).join('\n') + '\n',
        'utf8',
      );

      // 1. Export the source.
      const artifact = await exportInstance({
        output: scratch.exportPath,
        namespace: TEST_NAMESPACE,
        backend: 'polygraph',
        polygraphPath: scratch.sourcePath,
        auditPath: scratch.auditPath,
        grantsPath: scratch.grantsPath,
        substrateVersion: SUBSTRATE_VERSION,
        instanceSchemaVersion: INSTANCE_SCHEMA_VERSION,
        createdBy: 'roundtrip.test.ts',
      });
      expect(existsSync(scratch.exportPath)).toBe(true);
      expect(artifact.manifest.nodeCount).toBe(expectedNodes);
      expect(artifact.manifest.edgeCount).toBe(expectedEdges);
      expect(artifact.manifest.auditEventCount).toBe(auditEvents.length);
      expect(artifact.manifest.identityGrantCount).toBe(grants.length);
      expect(artifact.manifest.sigChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(artifact.manifest.backend).toBe('polygraph');
      expect(artifact.manifest.namespace).toBe(TEST_NAMESPACE);

      // 2. Import into a fresh PolyGraph.
      const result = await importInstance({
        input: scratch.exportPath,
        namespace: TEST_NAMESPACE,
        backend: 'polygraph',
        polygraphPath: scratch.targetPath,
        auditPath: scratch.targetAuditPath,
        grantsPath: scratch.targetGrantsPath,
        substrateVersion: SUBSTRATE_VERSION,
        performedBy: 'roundtrip.test.ts',
      });
      expect(result.nodesImported).toBe(expectedNodes);
      expect(result.edgesImported).toBe(expectedEdges);
      expect(result.migrationsApplied).toBe(0);
      expect(result.warnings).toEqual([]);
      // PolyGraph preserves node ids — nodeIdMap stays empty.
      expect(Object.keys(result.nodeIdMap)).toEqual([]);
      // Edge ids are minted fresh on PolyGraph; map has one entry per edge.
      expect(Object.keys(result.edgeIdMap).length).toBe(expectedEdges);

      // 3. Walk the target and verify node ids round-tripped.
      const targetAdapter = new LevelAdapter({ path: scratch.targetPath });
      const targetGraph = new PolyGraph({ adapter: targetAdapter });
      await targetGraph.open();
      try {
        const targetNodes = await targetGraph.allNodes();
        expect(targetNodes.length).toBe(expectedNodes);

        // Verify the Solution root is reachable by its original id.
        const sol = await targetGraph.getNode('sol-1');
        expect(sol).not.toBeNull();
        expect(sol?.labels).toContain('Solution');
        expect(sol?.properties.name).toBe('TEST-SOLUTION');
        expect(sol?.properties.namespace).toBe(TEST_NAMESPACE);

        // The principle node carrying tricky punctuation round-trips byte-for-byte.
        const p = await targetGraph.getNode('p-1');
        expect(p?.properties.driver).toBe(
          'spine integrity (commas, "quotes", and other tricky chars)',
        );

        // Hypothesis with verifiedAt = null round-trips.
        const h1 = await targetGraph.getNode('h-1');
        expect(h1?.properties.verifiedAt).toBeNull();
        expect(h1?.properties.status).toBe('open');

        // Hypothesis with non-null verifiedAt round-trips as a string.
        const h2 = await targetGraph.getNode('h-2');
        expect(h2?.properties.status).toBe('held');
        expect(h2?.properties.verifiedAt).toBe('2026-05-21T10:30:00-04:00');

        // Per-label edge counts match.
        const declaresHypothesis = await targetGraph.findRelationships('DECLARES_HYPOTHESIS');
        expect(declaresHypothesis.length).toBe(8); // 1 (h-1) + 1 (h-2) + 6 (extras)
        const hasContract = await targetGraph.findRelationships('HAS_CONTRACT');
        expect(hasContract.length).toBe(2);
        const composes = await targetGraph.findRelationships('COMPOSES');
        expect(composes.length).toBe(1);

        // Every imported relationship carries _originalId.
        for (const r of declaresHypothesis) {
          expect(typeof r.properties._originalId).toBe('string');
        }
      } finally {
        await targetGraph.close();
      }

      // 4. Audit ledger restored + import event recorded.
      expect(existsSync(scratch.targetAuditPath)).toBe(true);
      const auditOut = await readFile(scratch.targetAuditPath, 'utf8');
      const lines = auditOut.split('\n').filter((l) => l.trim().length > 0);
      // 5 original + 1 instance.import.completed
      expect(lines.length).toBe(auditEvents.length + 1);
      const lastEvent = JSON.parse(lines[lines.length - 1]);
      expect(lastEvent.eventType).toBe('instance.import.completed');
      expect(lastEvent.sourceManifest.sigChecksum).toBe(artifact.manifest.sigChecksum);
      expect(lastEvent.nodesImported).toBe(expectedNodes);
      expect(lastEvent.edgesImported).toBe(expectedEdges);

      // 5. Identity grants restored.
      expect(existsSync(scratch.targetGrantsPath)).toBe(true);
      const grantsOut = await readFile(scratch.targetGrantsPath, 'utf8');
      const grantLines = grantsOut.split('\n').filter((l) => l.trim().length > 0);
      expect(grantLines.length).toBe(grants.length);

      // 6. Idempotency — re-exporting the round-tripped instance
      // produces the SAME sigChecksum byte-for-byte.
      const reExportPath = join(scratch.root, 'reexport.tar.gz');
      const reArtifact = await exportInstance({
        output: reExportPath,
        namespace: TEST_NAMESPACE,
        backend: 'polygraph',
        polygraphPath: scratch.targetPath,
        // No audit/grants — checksum is over the SIG portion only.
        substrateVersion: SUBSTRATE_VERSION,
        instanceSchemaVersion: INSTANCE_SCHEMA_VERSION,
        createdBy: 'roundtrip.test.ts(re-export)',
      });
      expect(reArtifact.manifest.sigChecksum).toBe(artifact.manifest.sigChecksum);
      expect(reArtifact.manifest.nodeCount).toBe(expectedNodes);
      expect(reArtifact.manifest.edgeCount).toBe(expectedEdges);
    },
    60_000,
  );

  it('refuses to import into a non-empty instance without force', async () => {
    // Seed source.
    await buildSourceFixture();
    await exportInstance({
      output: scratch.exportPath,
      namespace: TEST_NAMESPACE,
      backend: 'polygraph',
      polygraphPath: scratch.sourcePath,
      substrateVersion: SUBSTRATE_VERSION,
      instanceSchemaVersion: INSTANCE_SCHEMA_VERSION,
    });

    // Seed target with one node in the same namespace.
    {
      const adapter = new LevelAdapter({ path: scratch.targetPath });
      const graph = new PolyGraph({ adapter });
      await graph.open();
      await graph.createNode(['Solution'], { name: 'EXISTING', namespace: TEST_NAMESPACE });
      await graph.close();
    }

    // Import without force → throws.
    await expect(
      importInstance({
        input: scratch.exportPath,
        namespace: TEST_NAMESPACE,
        backend: 'polygraph',
        polygraphPath: scratch.targetPath,
        substrateVersion: SUBSTRATE_VERSION,
      }),
    ).rejects.toThrow(/non-empty/i);
  });

  it('refuses to import an unrecognized exportSchemaVersion', async () => {
    // Build a tarball, then tamper its manifest.
    await buildSourceFixture();
    await exportInstance({
      output: scratch.exportPath,
      namespace: TEST_NAMESPACE,
      backend: 'polygraph',
      polygraphPath: scratch.sourcePath,
      substrateVersion: SUBSTRATE_VERSION,
      instanceSchemaVersion: INSTANCE_SCHEMA_VERSION,
    });

    // Untar, mutate manifest, re-tar — exercising the validator.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const tampered = join(scratch.root, 'tampered');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(tampered, { recursive: true });
    await exec('tar', ['-xzf', scratch.exportPath, '-C', tampered]);
    const manifest = await readManifest(join(tampered, 'manifest.json'));
    const bad = { ...manifest, exportSchemaVersion: '99.0.0' };
    await writeFile(join(tampered, 'manifest.json'), JSON.stringify(bad), 'utf8');
    const tamperedTar = join(scratch.root, 'tampered.tar.gz');
    await exec('tar', ['-czf', tamperedTar, '-C', tampered, '.']);

    await expect(
      importInstance({
        input: tamperedTar,
        namespace: TEST_NAMESPACE,
        backend: 'polygraph',
        polygraphPath: scratch.targetPath,
        substrateVersion: SUBSTRATE_VERSION,
      }),
    ).rejects.toThrow(/exportSchemaVersion/i);
  });
});
