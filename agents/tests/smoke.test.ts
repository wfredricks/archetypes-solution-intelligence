/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §A.
 *
 *   Ownership: asi-local.
 */

/**
 * Smoke test for `@asi/agents`. Asserts the public surface is wired.
 */

import { describe, it, expect } from 'vitest';
import * as agents from '../src/index.js';

describe('@asi/agents scaffold', () => {
  it('exposes both agent run functions', () => {
    expect(typeof agents.runCompletenessAgent).toBe('function');
    expect(typeof agents.runBookendAuditAgent).toBe('function');
  });

  it('exposes formatters for both agents', () => {
    expect(typeof agents.formatCompletenessMarkdown).toBe('function');
    expect(typeof agents.formatCompletenessJson).toBe('function');
    expect(typeof agents.formatBookendAuditMarkdown).toBe('function');
    expect(typeof agents.formatBookendAuditJson).toBe('function');
  });

  it('exposes the parseSnapshot helper', () => {
    expect(typeof agents.parseSnapshot).toBe('function');
  });

  it('exposes the agent names and versions', () => {
    expect(agents.COMPLETENESS_AGENT_NAME).toBe('CompletenessAgent');
    expect(agents.BOOKEND_AUDIT_AGENT_NAME).toBe('BookendAuditAgent');
    expect(agents.COMPLETENESS_AGENT_VERSION).toMatch(/^0\.2\.0-pre$/);
    expect(agents.BOOKEND_AUDIT_AGENT_VERSION).toMatch(/^0\.2\.0-pre$/);
  });

  it('exposes the staleness helper and threshold', () => {
    expect(agents.STALE_THRESHOLD_DAYS).toBe(90);
    expect(agents.isStale(null, new Date())).toBe(true);
  });

  it('summarize is exported', () => {
    expect(typeof agents.summarize).toBe('function');
  });
});
