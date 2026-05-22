/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §A.
 *
 *   Ownership: asi-local.
 *
 * @module index
 */

/**
 * Public surface for `@asi/agents`.
 *
 * // Why: the package ships exactly two agents (CompletenessAgent and
 * // BookendAuditAgent) plus the shared envelope types. We re-export
 * // formatters because the CLI uses them; downstream consumers can
 * // also import them directly.
 */

export type { AgentReport, AgentRunOptions, Finding, Severity } from './types.js';
export { summarize } from './types.js';

export {
  runCompletenessAgent,
  AGENT_NAME as COMPLETENESS_AGENT_NAME,
  AGENT_VERSION as COMPLETENESS_AGENT_VERSION,
  STALE_THRESHOLD_DAYS,
  isStale,
  normalizeIsoString,
  type CompletenessAgentOptions,
} from './completeness/completeness-agent.js';

export {
  formatMarkdown as formatCompletenessMarkdown,
  formatJson as formatCompletenessJson,
} from './completeness/format.js';

export {
  runBookendAuditAgent,
  AGENT_NAME as BOOKEND_AUDIT_AGENT_NAME,
  AGENT_VERSION as BOOKEND_AUDIT_AGENT_VERSION,
  type BookendAuditOptions,
} from './bookend-audit/bookend-audit-agent.js';

export {
  formatMarkdown as formatBookendAuditMarkdown,
  formatJson as formatBookendAuditJson,
} from './bookend-audit/format.js';

export { parseSnapshot, type ParsedSnapshotRow } from './bookend-audit/parse-snapshot.js';
