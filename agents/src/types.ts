/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §A.4.
 *
 *   Ownership: asi-local. solution-intel archetype's first agent
 *   surface; this package becomes ./reference-impl/agents/ in the
 *   archetype's next snapshot lift.
 *
 * @module types
 */

/**
 * Shared types for all agents in `@asi/agents`.
 *
 * // Why: every agent in this package emits findings into the same
 * // `AgentReport` envelope so downstream tooling (CLI formatters,
 * // future orchestrators) can consume any agent's output through one
 * // surface. The shape mirrors the SIG ontology - one Finding per
 * // rule firing, with the rule id encoding both the agent and the
 * // condition.
 */

/** Severity of a finding emitted by an agent. */
export type Severity = 'info' | 'warn' | 'error';

/**
 * A single observation emitted by an agent rule firing.
 *
 * The `ruleId` is the stable identifier - format `<agent>:<condition>`
 * (e.g. `completeness:hypothesis-stale`). `archetype` and `key` are
 * optional scope hints; they're populated when the finding is about
 * one specific archetype contract or one specific hypothesis row.
 */
export interface Finding {
  agentName: string;
  ruleId: string;
  severity: Severity;
  archetype?: string;
  key?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * A complete agent run result. One report per `run<Name>Agent()` call.
 *
 * `ranAt` is the ISO-8601 timestamp captured at the start of the run;
 * downstream tooling uses it to age reports (e.g. "agent ran > 7 days
 * ago, run it again").
 */
export interface AgentReport {
  agentName: string;
  agentVersion: string;
  namespace: string;
  ranAt: string;
  findings: Finding[];
  summary: {
    total: number;
    info: number;
    warn: number;
    error: number;
  };
}

/** Options accepted by every agent's `run()`. */
export interface AgentRunOptions {
  namespace?: string;
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
}

/**
 * Build a summary block from a findings array.
 *
 * // Why: every agent assembles this identically; centralizing the
 * // tally avoids drift in how we count severities.
 */
export function summarize(findings: Finding[]): AgentReport['summary'] {
  return {
    total: findings.length,
    info: findings.filter((f) => f.severity === 'info').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    error: findings.filter((f) => f.severity === 'error').length,
  };
}
