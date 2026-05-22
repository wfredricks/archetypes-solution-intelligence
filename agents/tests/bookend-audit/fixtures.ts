/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §C.6.
 *
 *   Ownership: asi-local.
 *
 * @module tests/bookend-audit/fixtures
 */

/**
 * Test fixtures for BookendAuditAgent.
 *
 * // Why: tests need a fake neo4j-driver session AND a fake archetypes
 * // checkout on disk. The disk side uses `os.tmpdir()` to honor the
 * // recipe's "no `/tmp/`" rule.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Driver, Session } from 'neo4j-driver';

/** Hypothesis row in the SIG-fetch shape. */
export interface FakeHypothesis {
  key: string;
  text: string;
  status: string;
  verifiedAt: string | null;
}

/** Build a fake driver whose session.run returns the supplied hypotheses. */
export function makeFakeBookendDriver(hypotheses: FakeHypothesis[]): Driver {
  const session: Partial<Session> = {
    async run() {
      return {
        records: hypotheses.map((h) => {
          // Why `keys`: Phase 2.5's Neo4jBackend.query() iterates
          // `record.keys` to build a plain object. The fake mirrors
          // that surface so the agent path stays uniform across real
          // Neo4j, fake-Neo4j, and PolyGraph.
          const obj = h as unknown as Record<string, unknown>;
          return {
            get(field: string) {
              return obj[field];
            },
            keys: Object.keys(obj),
          };
        }),
        summary: {} as never,
      } as never;
    },
    async close() {
      /* no-op */
    },
  };
  return {
    session: () => session as Session,
    async close() {
      /* no-op */
    },
  } as Driver;
}

/**
 * Create a temporary `archetypes` checkout in `os.tmpdir()` with one
 * archetype subdirectory containing an optional snapshot file. Returns
 * the absolute checkout path.
 */
export async function makeArchetypesCheckout(opts: {
  archetypeName: string;
  snapshot?: { date: string; rows: { key: string; text: string; status: string; evidence: string }[] };
}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asi-bookend-audit-'));
  const archetypeDir = path.join(root, opts.archetypeName);
  await mkdir(archetypeDir, { recursive: true });
  if (opts.snapshot) {
    const fileName = `RIGHT-BOOKEND-snapshot-${opts.snapshot.date}.md`;
    const body = renderSnapshot(opts.snapshot.rows);
    await writeFile(path.join(archetypeDir, fileName), body, 'utf8');
  }
  return root;
}

/** Render a snapshot body matching the shape `scripts/snapshot-events-spine.ts` emits. */
export function renderSnapshot(
  rows: { key: string; text: string; status: string; evidence: string }[],
): string {
  const lines: string[] = [];
  lines.push('# Snapshot');
  lines.push('');
  lines.push('| Key | Text (one-line) | Status | Evidence |');
  lines.push('|-----|------------------|--------|----------|');
  for (const r of rows) {
    const text = r.text.replace(/\|/g, '\\|');
    const evidence = r.evidence.replace(/\|/g, '\\|');
    lines.push(`| ${r.key} | ${text} | **${r.status}** | ${evidence} |`);
  }
  return lines.join('\n');
}
