/**
 * Parser test against the (retroactive) simple-auth LEFT-BOOKEND.md.
 *
 * // Why: simple-auth's left bookend was lifted retroactively and is
 * // honest about gaps (e.g. no Processes — primitive archetype). The
 * // parser tolerates section absence; this test pins that tolerance.
 */

import { describe, it, expect } from 'vitest';
import { parseBookend } from '../src/parse-bookend.js';

const SIMPLE_AUTH_BOOKEND =
  '/Users/williamfredricks/.openclaw/workspace/artifacts/archetypes/simple-auth/LEFT-BOOKEND.md';

describe('parseBookend — simple-auth LEFT-BOOKEND.md', () => {
  const graph = parseBookend(SIMPLE_AUTH_BOOKEND);

  it('reads identity from YAML front-matter', () => {
    expect(graph.contract.archetypeName).toBe('simple-auth');
    expect(graph.contract.archetypeKind).toBe('primitive');
    expect(graph.contract.archetypeVersion).toBe('lifted-2026-05-20');
  });

  it('finds five Principles P1–P5', () => {
    expect(graph.principles.map((p) => p.key)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
  });

  it('extracts a driver for P1 (Passwordless by design)', () => {
    const p1 = graph.principles.find((p) => p.key === 'P1');
    expect(p1!.name).toMatch(/Passwordless/i);
    expect(p1!.driver.length).toBeGreaterThan(0);
  });

  it('finds five Constraints C1–C5', () => {
    expect(graph.constraints.map((c) => c.key)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('finds six Services S1–S6 (item-form added 2026-05-21)', () => {
    expect(graph.services.map((s) => s.key)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  it('has no Processes (simple-auth is a primitive)', () => {
    expect(graph.processes).toEqual([]);
  });

  it('finds four DataObjects DO1–DO4', () => {
    expect(graph.dataObjects.map((d) => d.key)).toEqual(['DO1', 'DO2', 'DO3', 'DO4']);
  });

  it('finds six Hypotheses H1–H6', () => {
    expect(graph.hypotheses.map((h) => h.key)).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
    ]);
  });

  it('declares no compositions (primitive)', () => {
    expect(graph.composes).toEqual([]);
  });
});
