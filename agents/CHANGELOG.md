# Changelog

All notable changes to `@asi/agents` will be documented in this file.

## 0.1.0-pre — 2026-05-22

Initial release. Phase 1b of the asi adoption.

- `CompletenessAgent` — 7 rules: hypothesis status sweep (open/partial/violated/stale), contract-no-hypotheses, dataobject-orphan, service-no-process. Read-only.
- `BookendAuditAgent` — 6 rules: in-sync, missing-snapshot, hypothesis-added, hypothesis-removed, status-drift, verifiedAt-drift. Read-only on SIG; reads committed snapshot from disk.
- Markdown and JSON formatters for both agents.
- Public surface: `runCompletenessAgent`, `runBookendAuditAgent`, `formatMarkdown*`, `formatJson*`, `Finding`, `AgentReport`, `Severity`, `AgentRunOptions`, `BookendAuditOptions`.
