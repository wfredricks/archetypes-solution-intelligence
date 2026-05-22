/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §B.5.
 *
 *   Ownership: asi-local.
 *
 * @module completeness/format
 */

/**
 * Markdown and JSON formatters for the CompletenessAgent report.
 *
 * // Why: the agent emits a structured `AgentReport`; the CLI needs
 * // both human-readable (markdown) and machine-readable (JSON) views.
 * // Formatters are pure: same report in, same string out.
 */

import type { AgentReport, Finding } from '../types.js';

/**
 * Render a CompletenessAgent report as markdown.
 *
 * Format: one H1 with namespace + run timestamp, summary block, then
 * one H3 per finding (grouped naturally by ordering — the agent
 * already orders by archetype then key).
 */
export function formatMarkdown(report: AgentReport): string {
  const lines: string[] = [];
  lines.push(`# Completeness report — namespace \`${report.namespace}\``);
  lines.push(`*Ran ${report.ranAt} by ${report.agentName}@${report.agentVersion}*`);
  lines.push('');
  lines.push('## Summary');
  lines.push(
    `- Total findings: ${report.summary.total}  (info: ${report.summary.info}, warn: ${report.summary.warn}, error: ${report.summary.error})`,
  );
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('No findings. SIG is clean for the configured rules.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('## Findings');
  lines.push('');
  for (const f of report.findings) {
    lines.push(headingFor(f));
    lines.push(`- **${f.ruleId}** (${f.severity})`);
    lines.push(`- ${f.message}`);
    if (f.details && Object.keys(f.details).length > 0) {
      lines.push(`- details: \`${JSON.stringify(f.details)}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Render a CompletenessAgent report as JSON (2-space indent). */
export function formatJson(report: AgentReport): string {
  return JSON.stringify(report, null, 2);
}

function headingFor(f: Finding): string {
  // Why: we cluster findings by (archetype, key) when present so a
  // human scrolling the report sees scope in the heading. Findings
  // without scope (none currently emitted by this agent) fall back to
  // a rule-id heading so output stays well-formed.
  if (f.archetype && f.key) {
    return `### \`${f.archetype}\` — ${f.key}`;
  }
  if (f.archetype) {
    return `### \`${f.archetype}\``;
  }
  if (f.key) {
    return `### ${f.key}`;
  }
  return `### ${f.ruleId}`;
}
