/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §C.6.
 *
 *   Ownership: asi-local.
 */

/**
 * Unit tests for `BookendAuditAgent`. Mocks both the SIG (fake driver)
 * and the filesystem (temp `archetypes` checkout under `os.tmpdir()`).
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { runBookendAuditAgent } from '../../src/bookend-audit/bookend-audit-agent.js';
import { parseSnapshot } from '../../src/bookend-audit/parse-snapshot.js';
import {
  formatMarkdown,
  formatJson,
} from '../../src/bookend-audit/format.js';
import { makeFakeBookendDriver, makeArchetypesCheckout } from './fixtures.js';

const FIXED_NOW = new Date('2026-05-22T13:48:00.000Z');

describe('BookendAuditAgent', () => {
  it('emits bookend-audit:in-sync when SIG and snapshot match exactly', async () => {
    const rows = [
      { key: 'H1', text: 'h1', status: 'held', evidence: 'e1' },
      { key: 'H2', text: 'h2', status: 'partial', evidence: 'e2' },
    ];
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: { date: '2026-05-21', rows },
    });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'held', verifiedAt: null },
      { key: 'H2', text: 'h2', status: 'partial', verifiedAt: null },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].ruleId).toBe('bookend-audit:in-sync');
    expect(report.summary.info).toBe(1);
  });

  it('flags a hypothesis present in SIG but missing from snapshot', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [{ key: 'H1', text: 'h1', status: 'held', evidence: 'e' }],
      },
    });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'held', verifiedAt: null },
      { key: 'H2', text: 'new one', status: 'open', verifiedAt: null },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    expect(
      report.findings.find((f) => f.ruleId === 'bookend-audit:hypothesis-added'),
    ).toMatchObject({
      severity: 'warn',
      key: 'H2',
    });
  });

  it('flags a hypothesis present in snapshot but missing from SIG (error)', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [
          { key: 'H1', text: 'h1', status: 'held', evidence: 'e' },
          { key: 'H2', text: 'h2', status: 'held', evidence: 'e' },
        ],
      },
    });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'held', verifiedAt: null },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    const removed = report.findings.find((f) => f.ruleId === 'bookend-audit:hypothesis-removed');
    expect(removed).toBeDefined();
    expect(removed?.severity).toBe('error');
    expect(removed?.key).toBe('H2');
  });

  it('flags status drift between SIG and snapshot (warn)', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [{ key: 'H1', text: 'h1', status: 'held', evidence: 'e' }],
      },
    });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'partial', verifiedAt: null },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    const drift = report.findings.find((f) => f.ruleId === 'bookend-audit:status-drift');
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe('warn');
    expect(drift?.details).toMatchObject({ sigStatus: 'partial', committedStatus: 'held' });
  });

  it('flags verifiedAt drift when SIG has newer verifiedAt than snapshot date', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [{ key: 'H1', text: 'h1', status: 'held', evidence: 'e' }],
      },
    });
    const driver = makeFakeBookendDriver([
      // verifiedAt postdates 2026-05-21
      { key: 'H1', text: 'h1', status: 'held', verifiedAt: '2026-05-22T10:00:00.000Z' },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    const drift = report.findings.find((f) => f.ruleId === 'bookend-audit:verifiedAt-drift');
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe('info');
  });

  it('does NOT flag verifiedAt drift when verifiedAt predates snapshot date', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [{ key: 'H1', text: 'h1', status: 'held', evidence: 'e' }],
      },
    });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'held', verifiedAt: '2026-05-20T10:00:00.000Z' },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    expect(
      report.findings.find((f) => f.ruleId === 'bookend-audit:verifiedAt-drift'),
    ).toBeUndefined();
    expect(
      report.findings.find((f) => f.ruleId === 'bookend-audit:in-sync'),
    ).toBeDefined();
  });

  it('emits bookend-audit:missing-snapshot when no snapshot file exists', async () => {
    const repo = await makeArchetypesCheckout({ archetypeName: 'simple-auth' });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'open', verifiedAt: null },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'simple-auth',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'bookend-audit:missing-snapshot',
      severity: 'error',
      archetype: 'simple-auth',
    });
  });

  it('emits missing-snapshot when the archetype dir does not exist', async () => {
    const repo = await makeArchetypesCheckout({ archetypeName: 'events-spine' });
    const driver = makeFakeBookendDriver([]);
    const report = await runBookendAuditAgent({
      archetypeName: 'does-not-exist',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    expect(report.findings[0].ruleId).toBe('bookend-audit:missing-snapshot');
  });

  it('rolls up multiple findings in one run', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [
          { key: 'H1', text: 'h1', status: 'held', evidence: 'e' },
          { key: 'H2', text: 'h2', status: 'held', evidence: 'e' },
        ],
      },
    });
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'h1', status: 'partial', verifiedAt: null }, // status drift
      { key: 'H3', text: 'new', status: 'open', verifiedAt: null }, // added (H2 removed)
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    const ids = report.findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(
      [
        'bookend-audit:hypothesis-added',
        'bookend-audit:hypothesis-removed',
        'bookend-audit:status-drift',
      ].sort(),
    );
    expect(report.summary.error).toBe(1); // removed
    expect(report.summary.warn).toBe(2); // added + status-drift
  });

  it('picks the most recent snapshot when multiple exist', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: {
        date: '2026-05-21',
        rows: [{ key: 'H1', text: 'old', status: 'held', evidence: 'e' }],
      },
    });
    // add a newer one
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { renderSnapshot } = await import('./fixtures.js');
    await mkdir(path.join(repo, 'events-spine'), { recursive: true });
    await writeFile(
      path.join(repo, 'events-spine', 'RIGHT-BOOKEND-snapshot-2026-06-01.md'),
      renderSnapshot([{ key: 'H1', text: 'newer', status: 'partial', evidence: 'e' }]),
      'utf8',
    );
    const driver = makeFakeBookendDriver([
      { key: 'H1', text: 'newer', status: 'partial', verifiedAt: null },
    ]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      now: () => FIXED_NOW,
    });
    // The newer snapshot's H1 status is 'partial' matching the SIG -> in-sync
    expect(report.findings[0].ruleId).toBe('bookend-audit:in-sync');
  });

  it('propagates the namespace into the SIG query', async () => {
    const repo = await makeArchetypesCheckout({
      archetypeName: 'events-spine',
      snapshot: { date: '2026-05-21', rows: [] },
    });
    const driver = makeFakeBookendDriver([]);
    const report = await runBookendAuditAgent({
      archetypeName: 'events-spine',
      archetypesRepoPath: repo,
      driver,
      namespace: 'asi-other',
      now: () => FIXED_NOW,
    });
    expect(report.namespace).toBe('asi-other');
  });

  it('parseSnapshot extracts rows from a real snapshot body', () => {
    const body = `# header\n\n| Key | Text (one-line) | Status | Evidence |\n|-----|------------------|--------|----------|\n| H1 | text one | **held** | evidence one |\n| H2 | text two | **partial** | evidence two |\n\nsome prose after\n`;
    const rows = parseSnapshot(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ key: 'H1', text: 'text one', status: 'held', evidence: 'evidence one' });
    expect(rows[1].status).toBe('partial');
  });

  it('parseSnapshot tolerates escaped pipes inside cells', () => {
    const body = `| Key | Text (one-line) | Status | Evidence |\n|--|--|--|--|\n| H1 | a \\| b \\| c | **held** | e |\n`;
    const rows = parseSnapshot(body);
    expect(rows[0].text).toBe('a | b | c');
  });

  it('parseSnapshot ignores rows whose key is not H<n>', () => {
    const body = `| Key | Text (one-line) | Status | Evidence |\n|--|--|--|--|\n| weird | x | y | z |\n| H1 | a | b | c |\n`;
    const rows = parseSnapshot(body);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('H1');
  });

  it('formatMarkdown renders bookend-audit report', () => {
    const report = {
      agentName: 'BookendAuditAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'BookendAuditAgent',
          ruleId: 'bookend-audit:in-sync',
          severity: 'info' as const,
          archetype: 'events-spine',
          message: 'matches',
          details: { hypothesisCount: 7 },
        },
      ],
      summary: { total: 1, info: 1, warn: 0, error: 0 },
    };
    const md = formatMarkdown(report);
    expect(md).toMatch(/# Bookend-audit report/);
    expect(md).toMatch(/### `events-spine`/);
    expect(md).toMatch(/bookend-audit:in-sync/);
    expect(md).toMatch(/details:/);
  });

  it('formatMarkdown renders an empty report', () => {
    const md = formatMarkdown({
      agentName: 'BookendAuditAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [],
      summary: { total: 0, info: 0, warn: 0, error: 0 },
    });
    expect(md).toMatch(/No findings/);
  });

  it('formatMarkdown uses key heading when both archetype and key present', () => {
    const md = formatMarkdown({
      agentName: 'BookendAuditAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'BookendAuditAgent',
          ruleId: 'bookend-audit:status-drift',
          severity: 'warn',
          archetype: 'events-spine',
          key: 'H4',
          message: 'drift',
        },
      ],
      summary: { total: 1, info: 0, warn: 1, error: 0 },
    });
    expect(md).toMatch(/### `events-spine` — H4/);
  });

  it('formatMarkdown falls back to ruleId heading without scope', () => {
    const md = formatMarkdown({
      agentName: 'BookendAuditAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'BookendAuditAgent',
          ruleId: 'bookend-audit:missing-snapshot',
          severity: 'error',
          message: 'no file',
        },
      ],
      summary: { total: 1, info: 0, warn: 0, error: 1 },
    });
    expect(md).toMatch(/### bookend-audit:missing-snapshot/);
  });

  it('formatJson round-trips', () => {
    const report = {
      agentName: 'BookendAuditAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [],
      summary: { total: 0, info: 0, warn: 0, error: 0 },
    };
    expect(JSON.parse(formatJson(report))).toEqual(report);
  });
});
