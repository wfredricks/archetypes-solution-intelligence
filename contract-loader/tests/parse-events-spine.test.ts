/**
 * Parser test against the real events-spine LEFT-BOOKEND.md.
 *
 * // Why: events-spine is the canonical bookend shape (METHODOLOGY.md
 * // §Bookends). If this test breaks, either the parser regressed or the
 * // bookend drifted from the documented shape — both need surfacing.
 */

import { describe, it, expect } from 'vitest';
import { parseBookend } from '../src/parse-bookend.js';

const EVENTS_SPINE_BOOKEND =
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md';

describe('parseBookend — events-spine LEFT-BOOKEND.md', () => {
  const graph = parseBookend(EVENTS_SPINE_BOOKEND);

  it('reads identity from YAML front-matter', () => {
    expect(graph.contract.archetypeName).toBe('events-spine');
    expect(graph.contract.archetypeKind).toBe('composite');
    expect(graph.contract.archetypeVersion).toBe('v0.1.0-pre');
    expect(graph.contract.contractId).toBe('events-spine-v0.1.0-pre');
    expect(graph.contract.sourceBookend).toBe(EVENTS_SPINE_BOOKEND);
  });

  it('finds five Principles P1–P5', () => {
    expect(graph.principles.map((p) => p.key)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
  });

  it('extracts driver, consequences, and alternative for P1', () => {
    const p1 = graph.principles.find((p) => p.key === 'P1');
    expect(p1).toBeDefined();
    expect(p1!.name).toMatch(/Scribe is a complete record by default/i);
    expect(p1!.driver).toMatch(/Operational simplicity/i);
    expect(p1!.consequences.length).toBeGreaterThanOrEqual(2);
    expect(p1!.alternativeConsidered).toMatch(/empty subject filter/i);
  });

  it('finds five Constraints C1–C5', () => {
    expect(graph.constraints.map((c) => c.key)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('finds six Services S1–S6', () => {
    expect(graph.services.map((s) => s.key)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  it('finds two Processes Pr1–Pr2 with triggers', () => {
    expect(graph.processes.map((p) => p.key)).toEqual(['Pr1', 'Pr2']);
    const pr1 = graph.processes.find((p) => p.key === 'Pr1');
    expect(pr1!.trigger).toMatch(/Scribe process starts/i);
  });

  it('finds two DataObjects DO1–DO2', () => {
    expect(graph.dataObjects.map((d) => d.key)).toEqual(['DO1', 'DO2']);
  });

  it('finds seven Hypotheses H1–H7', () => {
    expect(graph.hypotheses.map((h) => h.key)).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'H7',
    ]);
  });

  it('parses every hypothesis as open + verifiedAt null', () => {
    // Why: bookend-parsed hypotheses are by definition `open` and
    // unverified; writeback scripts later flip status + populate
    // verifiedAt. If a future parser change forgets to default
    // verifiedAt, this test surfaces it before commit + round-trip.
    for (const h of graph.hypotheses) {
      expect(h.status).toBe('open');
      expect(h.verifiedAt).toBeNull();
    }
  });

  it('lists four composed primitives', () => {
    expect(graph.composes.sort()).toEqual(
      ['mcp-proxy', 'scribe', 'simple-pubsub', 'simple-subscriber'].sort(),
    );
  });
});
