/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §B.6.
 *
 *   Ownership: asi-local.
 */

/**
 * Unit tests for `CompletenessAgent`. Drives the agent against a fake
 * neo4j session that returns canned record sets for each rule. Covers
 * every rule in the v0.1 set plus the staleness boundary and a
 * defensive check for an unknown status string.
 */

import { describe, it, expect } from 'vitest';

import {
  runCompletenessAgent,
  isStale,
  normalizeIsoString,
  STALE_THRESHOLD_DAYS,
} from '../../src/completeness/completeness-agent.js';
import { formatMarkdown, formatJson } from '../../src/completeness/format.js';
import {
  makeFakeDriver,
  hypothesisRow,
  noHypothesisContractRow,
  orphanDataObjectRow,
  serviceNoProcessRow,
  PATTERNS,
} from './fixtures.js';

const FIXED_NOW = new Date('2026-05-22T13:48:00.000Z');

function emptyPatterns() {
  return [
    { match: PATTERNS.hypotheses, records: [] },
    { match: PATTERNS.contractsNoHypotheses, records: [] },
    { match: PATTERNS.orphanDataObjects, records: [] },
    { match: PATTERNS.servicesNoProcess, records: [] },
  ];
}

describe('CompletenessAgent', () => {
  it('emits an empty report when the namespace is empty', async () => {
    const driver = makeFakeDriver({ patterns: emptyPatterns() });
    const report = await runCompletenessAgent({
      driver,
      namespace: 'asi-test',
      now: () => FIXED_NOW,
    });
    expect(report.agentName).toBe('CompletenessAgent');
    expect(report.namespace).toBe('asi-test');
    expect(report.ranAt).toBe(FIXED_NOW.toISOString());
    expect(report.findings).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });

  it('flags an open hypothesis as info', async () => {
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('simple-auth', 'H1', 'open')],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'completeness:hypothesis-open',
      severity: 'info',
      archetype: 'simple-auth',
      key: 'H1',
    });
    expect(report.summary).toEqual({ total: 1, info: 1, warn: 0, error: 0 });
  });

  it('flags a partial hypothesis as warn', async () => {
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('events-spine', 'H4', 'partial', '2026-05-21T20:32:12.766Z')],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].ruleId).toBe('completeness:hypothesis-partial');
    expect(report.findings[0].severity).toBe('warn');
  });

  it('flags a violated hypothesis as error', async () => {
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('events-spine', 'H7', 'violated', null)],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings[0].ruleId).toBe('completeness:hypothesis-violated');
    expect(report.findings[0].severity).toBe('error');
    expect(report.summary.error).toBe(1);
  });

  it('flags a held-with-null-verifiedAt as stale (warn)', async () => {
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('events-spine', 'H1', 'held', null)],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'completeness:hypothesis-stale',
      severity: 'warn',
    });
    expect(report.findings[0].message).toMatch(/null/);
  });

  it('flags a held-with-old-verifiedAt as stale', async () => {
    // verifiedAt = 91 days before FIXED_NOW
    const tooOld = new Date(FIXED_NOW.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('events-spine', 'H2', 'held', tooOld)],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].ruleId).toBe('completeness:hypothesis-stale');
    expect(report.findings[0].message).toMatch(new RegExp(`${STALE_THRESHOLD_DAYS}`));
  });

  it('does NOT flag a held-with-fresh-verifiedAt', async () => {
    const fresh = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('events-spine', 'H3', 'held', fresh)],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(0);
  });

  it('flags a contract with no hypotheses', async () => {
    const driver = makeFakeDriver({
      patterns: [
        { match: PATTERNS.hypotheses, records: [] },
        {
          match: PATTERNS.contractsNoHypotheses,
          records: [noHypothesisContractRow('mystery-archetype')],
        },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'completeness:contract-no-hypotheses',
      severity: 'warn',
      archetype: 'mystery-archetype',
    });
  });

  it('flags an orphan DataObject', async () => {
    const driver = makeFakeDriver({
      patterns: [
        { match: PATTERNS.hypotheses, records: [] },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        {
          match: PATTERNS.orphanDataObjects,
          records: [orphanDataObjectRow('DO99', 'StrayPayload')],
        },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'completeness:dataobject-orphan',
      severity: 'info',
      key: 'DO99',
    });
    expect(report.findings[0].message).toMatch(/StrayPayload/);
  });

  it('flags a service with no process', async () => {
    const driver = makeFakeDriver({
      patterns: [
        { match: PATTERNS.hypotheses, records: [] },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        {
          match: PATTERNS.servicesNoProcess,
          records: [serviceNoProcessRow('simple-auth', 'S1', 'login')],
        },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'completeness:service-no-process',
      severity: 'info',
      archetype: 'simple-auth',
      key: 'S1',
    });
  });

  it('reports an unknown status as warn (defensive)', async () => {
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [hypothesisRow('weird', 'H1', 'novel-status', null)],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [] },
        { match: PATTERNS.orphanDataObjects, records: [] },
        { match: PATTERNS.servicesNoProcess, records: [] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe('warn');
    expect(report.findings[0].message).toMatch(/unrecognized/);
  });

  it('propagates the namespace into the SIG queries', async () => {
    const calls: { cypher: string; params: Record<string, unknown> }[] = [];
    const driver = makeFakeDriver({ patterns: emptyPatterns(), calls });
    await runCompletenessAgent({ driver, namespace: 'asi-other', now: () => FIXED_NOW });
    expect(calls.length).toBe(4);
    for (const c of calls) {
      expect(c.params.namespace).toBe('asi-other');
    }
  });

  it('rolls up summary counts across mixed findings', async () => {
    const tooOld = new Date(FIXED_NOW.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const driver = makeFakeDriver({
      patterns: [
        {
          match: PATTERNS.hypotheses,
          records: [
            hypothesisRow('a', 'H1', 'open'),
            hypothesisRow('a', 'H2', 'partial'),
            hypothesisRow('a', 'H3', 'violated'),
            hypothesisRow('a', 'H4', 'held', tooOld),
          ],
        },
        { match: PATTERNS.contractsNoHypotheses, records: [noHypothesisContractRow('b')] },
        { match: PATTERNS.orphanDataObjects, records: [orphanDataObjectRow('DO1')] },
        { match: PATTERNS.servicesNoProcess, records: [serviceNoProcessRow('a', 'S1')] },
      ],
    });
    const report = await runCompletenessAgent({ driver, now: () => FIXED_NOW });
    expect(report.summary.total).toBe(7);
    expect(report.summary.info).toBe(3); // open, orphan-DO, service-no-process
    expect(report.summary.warn).toBe(3); // partial, stale, contract-no-hypotheses
    expect(report.summary.error).toBe(1); // violated
  });

  it('isStale returns true for invalid ISO strings', () => {
    expect(isStale('not-a-date', FIXED_NOW)).toBe(true);
    expect(isStale('', FIXED_NOW)).toBe(true);
    expect(isStale(null, FIXED_NOW)).toBe(true);
    expect(isStale(undefined, FIXED_NOW)).toBe(true);
  });

  it('isStale returns false on the boundary at exactly threshold-1ms', () => {
    const onTheLine = new Date(
      FIXED_NOW.getTime() - (STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000 - 1),
    ).toISOString();
    expect(isStale(onTheLine, FIXED_NOW)).toBe(false);
  });

  it('formatMarkdown renders an empty report cleanly', () => {
    const report = {
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [],
      summary: { total: 0, info: 0, warn: 0, error: 0 },
    };
    const md = formatMarkdown(report);
    expect(md).toMatch(/# Completeness report/);
    expect(md).toMatch(/No findings/);
  });

  it('formatMarkdown renders findings with heading + rule + message', () => {
    const report = {
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'CompletenessAgent',
          ruleId: 'completeness:hypothesis-open',
          severity: 'info' as const,
          archetype: 'simple-auth',
          key: 'H1',
          message: 'Hypothesis H1 is open (expected for un-adopted archetypes).',
        },
      ],
      summary: { total: 1, info: 1, warn: 0, error: 0 },
    };
    const md = formatMarkdown(report);
    expect(md).toMatch(/### `simple-auth` — H1/);
    expect(md).toMatch(/completeness:hypothesis-open/);
    expect(md).toMatch(/info/);
  });

  it('formatMarkdown falls back to rule-id heading when no archetype/key', () => {
    const md = formatMarkdown({
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'CompletenessAgent',
          ruleId: 'completeness:contract-no-hypotheses',
          severity: 'warn',
          message: 'some message',
        },
      ],
      summary: { total: 1, info: 0, warn: 1, error: 0 },
    });
    expect(md).toMatch(/### completeness:contract-no-hypotheses/);
  });

  it('formatMarkdown uses an archetype-only heading when key is absent', () => {
    const md = formatMarkdown({
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'CompletenessAgent',
          ruleId: 'completeness:contract-no-hypotheses',
          severity: 'warn',
          archetype: 'lonely',
          message: 'no hypotheses',
        },
      ],
      summary: { total: 1, info: 0, warn: 1, error: 0 },
    });
    expect(md).toMatch(/### `lonely`/);
  });

  it('formatMarkdown uses a key-only heading when archetype is absent', () => {
    const md = formatMarkdown({
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'CompletenessAgent',
          ruleId: 'completeness:dataobject-orphan',
          severity: 'info',
          key: 'DO9',
          message: 'orphan',
        },
      ],
      summary: { total: 1, info: 1, warn: 0, error: 0 },
    });
    expect(md).toMatch(/### DO9/);
  });

  it('formatMarkdown includes details when present', () => {
    const md = formatMarkdown({
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [
        {
          agentName: 'CompletenessAgent',
          ruleId: 'completeness:hypothesis-open',
          severity: 'info',
          archetype: 'a',
          key: 'H1',
          message: 'x',
          details: { status: 'open', verifiedAt: null },
        },
      ],
      summary: { total: 1, info: 1, warn: 0, error: 0 },
    });
    expect(md).toMatch(/details:/);
  });

  it('normalizeIsoString handles null/undefined/strings/DateTime-like objects', () => {
    expect(normalizeIsoString(null)).toBe(null);
    expect(normalizeIsoString(undefined)).toBe(null);
    expect(normalizeIsoString('2026-05-21T20:32:12.766Z')).toBe('2026-05-21T20:32:12.766Z');
    // Mimic a Neo4j DateTime via duck-typing on toString().
    const fakeDateTime = { toString: () => '2026-05-21T20:32:12.766Z' };
    expect(normalizeIsoString(fakeDateTime)).toBe('2026-05-21T20:32:12.766Z');
    expect(normalizeIsoString({})).toBe(null);
    expect(normalizeIsoString(42)).toBe(null);
  });

  it('formatJson round-trips the report', () => {
    const report = {
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi',
      ranAt: FIXED_NOW.toISOString(),
      findings: [],
      summary: { total: 0, info: 0, warn: 0, error: 0 },
    };
    const parsed = JSON.parse(formatJson(report));
    expect(parsed).toEqual(report);
  });
});
