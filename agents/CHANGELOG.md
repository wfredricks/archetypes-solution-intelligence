# Changelog

All notable changes to `@asi/agents` will be documented in this file.

## 0.2.0-pre — 2026-05-22

Phase 2.5 of the asi adoption: PolyGraph backend lifted from contract-loader's adapter pattern.

- `Backend` interface + `selectBackend(opts)` adapter — pattern byte-lifted from `contract-loader/src/backends/types.ts` + `select.ts` (Phase 1e). Two implementations: `Neo4jBackend` (default, preserves the pre-2.5 path) and `PolyGraphBackend` (new, embeds polygraph-db@0.1.4 via LevelAdapter).
- `runCompletenessAgent` and `runBookendAuditAgent` accept two new optional fields: `backend?: 'neo4j' | 'polygraph'` and `polygraphPath?: string`. Backend selection precedence matches contract-loader (Phase 1e): explicit `driver` → Neo4j; explicit `backend === 'polygraph'` → PolyGraph; `polygraphPath` set → PolyGraph; `graphUrl` startsWith `bolt://` → Neo4j; default → Neo4j.
- `Backend.native` extended with two helpers — `countOutgoingRels(nodeId, types[])` and `countIncomingRels(nodeId, types[])` — used by CompletenessAgent's three aggregation sites (rules 5/6/7) on the PolyGraph path. The bridge does NOT grow `OPTIONAL MATCH + WITH + count(...)`; agents pick the right tool per query.
- `tests/backends-differential.test.ts` (new, 13 cases): parametrized via `describe.each` across both backends; Neo4j leg gated on Bolt reachability per the events-spine harness pattern.
- Public function signatures of `runCompletenessAgent` / `runBookendAuditAgent` are byte-for-byte unchanged from 0.1.0-pre.
- Adds `polygraph-db` (`file:../../polygraph`) as a direct dependency.
- Bumps agent version constants `COMPLETENESS_AGENT_VERSION` and `BOOKEND_AUDIT_AGENT_VERSION` to `0.2.0-pre`.

## 0.1.0-pre — 2026-05-22

Initial release. Phase 1b of the asi adoption.

- `CompletenessAgent` — 7 rules: hypothesis status sweep (open/partial/violated/stale), contract-no-hypotheses, dataobject-orphan, service-no-process. Read-only.
- `BookendAuditAgent` — 6 rules: in-sync, missing-snapshot, hypothesis-added, hypothesis-removed, status-drift, verifiedAt-drift. Read-only on SIG; reads committed snapshot from disk.
- Markdown and JSON formatters for both agents.
- Public surface: `runCompletenessAgent`, `runBookendAuditAgent`, `formatMarkdown*`, `formatJson*`, `Finding`, `AgentReport`, `Severity`, `AgentRunOptions`, `BookendAuditOptions`.
