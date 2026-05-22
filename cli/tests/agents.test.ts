/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §D.2.
 *
 *   Ownership: asi-local.
 */

/**
 * Unit tests for `asi agents` CLI wiring.
 *
 * // Why: agents/ tests cover the agent logic; these tests cover the
 * // CLI layer (flag parsing, exit codes, format routing, missing-flag
 * // diagnostics). We mock `@asi/agents` so no SIG is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';

vi.mock('@asi/agents', () => {
  return {
    runCompletenessAgent: vi.fn(async () => ({
      agentName: 'CompletenessAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi-test',
      ranAt: '2026-05-22T13:48:00.000Z',
      findings: [
        {
          agentName: 'CompletenessAgent',
          ruleId: 'completeness:hypothesis-open',
          severity: 'info',
          archetype: 'simple-auth',
          key: 'H1',
          message: 'open',
        },
      ],
      summary: { total: 1, info: 1, warn: 0, error: 0 },
    })),
    runBookendAuditAgent: vi.fn(async () => ({
      agentName: 'BookendAuditAgent',
      agentVersion: '0.1.0-pre',
      namespace: 'asi-test',
      ranAt: '2026-05-22T13:48:00.000Z',
      findings: [
        {
          agentName: 'BookendAuditAgent',
          ruleId: 'bookend-audit:in-sync',
          severity: 'info',
          archetype: 'events-spine',
          message: 'matches',
        },
      ],
      summary: { total: 1, info: 1, warn: 0, error: 0 },
    })),
    formatCompletenessMarkdown: vi.fn(() => '## completeness-md\n'),
    formatCompletenessJson: vi.fn(() => '{"completeness":"json"}'),
    formatBookendAuditMarkdown: vi.fn(() => '## bookend-audit-md\n'),
    formatBookendAuditJson: vi.fn(() => '{"bookend":"json"}'),
  };
});

import {
  agentsListCommand,
  completenessRunCommand,
  bookendAuditRunCommand,
  parseFormat,
} from '../src/commands/agents.js';

async function collect(s: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of s) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('asi agents CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agents list prints both agents and exits 0', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = agentsListCommand({ stdout: out, stderr: err });
    out.end();
    err.end();
    expect(code).toBe(0);
    const txt = await collect(out);
    expect(txt).toMatch(/completeness/);
    expect(txt).toMatch(/bookend-audit/);
    expect(txt).toMatch(/read-only/);
  });

  it('completeness run exits 0 and writes markdown by default', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await completenessRunCommand({
      namespace: 'asi-test',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe('## completeness-md\n');
  });

  it('completeness run writes JSON when --format=json', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await completenessRunCommand({
      namespace: 'asi-test',
      format: 'json',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe('{"completeness":"json"}\n');
  });

  it('completeness run exits 1 on tooling failure', async () => {
    const mod = await import('@asi/agents');
    (mod.runCompletenessAgent as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error('cannot reach polygraph'),
    );
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await completenessRunCommand({ stdout: out, stderr: err });
    out.end();
    err.end();
    expect(code).toBe(1);
    expect(await collect(err)).toMatch(/cannot reach polygraph/);
  });

  it('bookend-audit run requires --archetype', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await bookendAuditRunCommand({
      archetypesRepo: '/tmp/archetypes',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(2);
    expect(await collect(err)).toMatch(/--archetype is required/);
  });

  it('bookend-audit run requires --archetypes-repo', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await bookendAuditRunCommand({
      archetype: 'events-spine',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(2);
    expect(await collect(err)).toMatch(/--archetypes-repo is required/);
  });

  it('bookend-audit run exits 0 with markdown by default', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await bookendAuditRunCommand({
      archetype: 'events-spine',
      archetypesRepo: '/tmp/archetypes',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe('## bookend-audit-md\n');
  });

  it('bookend-audit run writes JSON when --format=json', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await bookendAuditRunCommand({
      archetype: 'events-spine',
      archetypesRepo: '/tmp/archetypes',
      format: 'json',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe('{"bookend":"json"}\n');
  });

  it('bookend-audit run exits 1 on tooling failure', async () => {
    const mod = await import('@asi/agents');
    (
      mod.runBookendAuditAgent as unknown as { mockRejectedValueOnce: (e: Error) => void }
    ).mockRejectedValueOnce(new Error('disk read failed'));
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await bookendAuditRunCommand({
      archetype: 'events-spine',
      archetypesRepo: '/tmp/archetypes',
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(1);
    expect(await collect(err)).toMatch(/disk read failed/);
  });

  it('parseFormat returns markdown by default and rejects unknown values', () => {
    expect(parseFormat(undefined)).toBe('markdown');
    expect(parseFormat('markdown')).toBe('markdown');
    expect(parseFormat('json')).toBe('json');
    expect(parseFormat('yaml')).toBe(null);
  });
});
