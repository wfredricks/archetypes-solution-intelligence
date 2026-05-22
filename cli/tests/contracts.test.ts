/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase E3.
 *
 *   Ownership: asi-local.
 */

/**
 * CLI integration test for `asi contracts list` and `asi contracts show`.
 *
 * // Why: The CLI is the operator's surface. Parser + committer unit
 * // tests verify the data path; this test verifies the read-side commands
 * // produce the right exit codes and stream the right text.
 *
 * // Test isolation: a test-only namespace ("asi-test-contracts-cli") is
 * // seeded with a Solution root, the events-spine contract is loaded
 * // through the loader, then the two CLI command functions are driven
 * // with captured stdout streams and the namespace override.
 *
 * // The test skips if PolyGraph is not reachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import neo4j, { type Driver } from 'neo4j-driver';

import { parseBookend, commitContract } from '@asi/contract-loader';
import {
  contractsListCommand,
  contractsShowCommand,
} from '../src/commands/contracts.js';

const GRAPH_URL = process.env.ASI_GRAPH_URL ?? 'bolt://localhost:7689';
const GRAPH_USER = process.env.ASI_GRAPH_USER ?? 'neo4j';
const GRAPH_PASS = process.env.ASI_GRAPH_PASS ?? 'udt-pass-2026';
const TEST_NAMESPACE = 'asi-test-contracts-cli';
const EVENTS_SPINE_BOOKEND =
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md';

let driver: Driver | null = null;
let polygraphReachable = false;

async function collect(stream: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

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

  // Seed test-only Solution root.
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

describe('asi contracts CLI', () => {
  it('list returns "No contracts" when namespace is empty', async () => {
    if (!polygraphReachable) return;
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await contractsListCommand({
      namespace: TEST_NAMESPACE,
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toMatch(/No contracts loaded/i);
  });

  it('list returns the events-spine row after loading', async () => {
    if (!polygraphReachable) return;
    const graph = parseBookend(EVENTS_SPINE_BOOKEND);
    await commitContract(graph, { namespace: TEST_NAMESPACE, driver: driver! });

    const out = new PassThrough();
    const err = new PassThrough();
    const code = await contractsListCommand({
      namespace: TEST_NAMESPACE,
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    const text = await collect(out);
    expect(text).toMatch(/events-spine/);
    expect(text).toMatch(/composite/);
    expect(text).toMatch(/v0\.1\.0-pre/);
  });

  it('show prints the structured detail for events-spine', async () => {
    if (!polygraphReachable) return;
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await contractsShowCommand('events-spine', {
      namespace: TEST_NAMESPACE,
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    const text = await collect(out);
    expect(text).toMatch(/# Contract: events-spine/);
    expect(text).toMatch(/## Principles \(5\)/);
    expect(text).toMatch(/## Constraints \(5\)/);
    expect(text).toMatch(/## Services \(6\)/);
    expect(text).toMatch(/## Processes \(2\)/);
    expect(text).toMatch(/## DataObjects \(2\)/);
    expect(text).toMatch(/## Hypotheses \(7\)/);
  });

  it('show renders [open] status with no verified suffix for parsed hypotheses', async () => {
    // Why: F1.b contract — every bookend-parsed hypothesis is `open` and
    // unverified; the CLI must surface `[open]` and must NOT print a
    // ` verified=` suffix when verifiedAt is null.
    if (!polygraphReachable) return;
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await contractsShowCommand('events-spine', {
      namespace: TEST_NAMESPACE,
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    const text = await collect(out);
    // Every hypothesis row should carry an [open] status tag.
    expect(text).toMatch(/H1: \[open\]\s+/);
    expect(text).toMatch(/H7: \[open\]\s+/);
    // No `verified=` should appear yet.
    expect(text).not.toMatch(/verified=/);
  });

  it('show renders [held] status + verified=<ISO> for written-back hypotheses', async () => {
    // Why: F1.b contract — once writeback flips H6+H7 to `held` with an
    // ISO timestamp, the CLI must surface both inline. The loader's
    // round-trip is covered in contract-loader/tests; here we assert the
    // CLI render shape end-to-end.
    if (!polygraphReachable) return;
    const graph = parseBookend(EVENTS_SPINE_BOOKEND);
    const verifiedAtStamp = '2026-05-21T18:30:00.000Z';
    for (const h of graph.hypotheses) {
      if (h.key === 'H6' || h.key === 'H7') {
        h.status = 'held';
        h.verifiedAt = verifiedAtStamp;
      }
    }
    await commitContract(graph, { namespace: TEST_NAMESPACE, driver: driver! });

    const out = new PassThrough();
    const err = new PassThrough();
    const code = await contractsShowCommand('events-spine', {
      namespace: TEST_NAMESPACE,
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(0);
    const text = await collect(out);
    // Why: hypothesis text can span newlines (parser preserves multi-line
    // bullet bodies), so use [\s\S]*? to match across them up to the
    // verified= suffix the renderer appends to ${h.text}${verified}.
    expect(text).toMatch(new RegExp(`H6: \\[held\\]\\s+[\\s\\S]*?verified=${verifiedAtStamp}`));
    expect(text).toMatch(new RegExp(`H7: \\[held\\]\\s+[\\s\\S]*?verified=${verifiedAtStamp}`));
    // H1 still open + still no verified= suffix on its line.
    expect(text).toMatch(/H1: \[open\]\s+/);
    const h1Line = text.split('\n').find((l) => l.includes('H1:'));
    expect(h1Line).toBeDefined();
    expect(h1Line!).not.toMatch(/verified=/);
  });

  it('show returns exit 1 for an unknown archetype', async () => {
    if (!polygraphReachable) return;
    const out = new PassThrough();
    const err = new PassThrough();
    const code = await contractsShowCommand('does-not-exist', {
      namespace: TEST_NAMESPACE,
      stdout: out,
      stderr: err,
    });
    out.end();
    err.end();
    expect(code).toBe(1);
    expect(await collect(err)).toMatch(/no contract found/i);
  });
});
