/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §C.
 *
 *   Ownership: asi-local.
 *
 * @module bookend-audit/format
 */

/**
 * Markdown and JSON formatters for the BookendAuditAgent report.
 *
 * // Why: identical shape to completeness/format.ts so downstream
 * // tooling can render either agent's report with the same code path.
 * // Differs only in the report's top heading.
 */

import type { AgentReport, Finding } from '../types.js';

/** Render a BookendAuditAgent report as markdown. */
export function formatMarkdown(report: AgentReport): string {
  const lines: string[] = [];
  lines.push(`# Bookend-audit report — namespace \`${report.namespace}\``);
  lines.push(`*Ran ${report.ranAt} by ${report.agentName}@${report.agentVersion}*`);
  lines.push('');
  lines.push('## Summary');
  lines.push(
    `- Total findings: ${report.summary.total}  (info: ${report.summary.info}, warn: ${report.summary.warn}, error: ${report.summary.error})`,
  );
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('No findings.');
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

/** Render a BookendAuditAgent report as JSON (2-space indent). */
export function formatJson(report: AgentReport): string {
  return JSON.stringify(report, null, 2);
}

function headingFor(f: Finding): string {
  if (f.archetype && f.key) {
    return `### \`${f.archetype}\` — ${f.key}`;
  }
  if (f.archetype) {
    return `### \`${f.archetype}\``;
  }
  return `### ${f.ruleId}`;
}
