# Changelog

## 0.2.0-pre — 2026-05-22

**Backend-pluggable.** Contract-loader now ships a `Backend` adapter so the same writer + reader works against either Neo4j or PolyGraph. Public function signatures of `commitContract` / `verifyContract` / `listContracts` / `showContract` are unchanged — the selector is a new optional field on the options object.

### Added

- `src/backends/types.ts` — `Backend` interface (`kind`, `query()`, `native.findNodes`/`findRelationships`, `close()`), `BackendOptions`, `resolveBackendKind()`.
- `src/backends/neo4j-backend.ts` — the existing Phase 1c plumbing wrapped behind `Backend`. Behavior byte-for-byte identical.
- `src/backends/polygraph-backend.ts` — new backend embedding `polygraph-db@0.1.4` via `LevelAdapter`. Routes commit-side cypher writes (CREATE with property literals, MATCH+CREATE+CREATE, MATCH+MATCH+MERGE) to native primitives because the v0.1.4 regex bridge mangles property values that contain commas, parens, or embedded quotes. Read-side queries go through the bridge with adapter-side `$param` substitution, `count(...)` aggregation fallback, and JavaScript `ORDER BY` post-sort.
- `src/backends/select.ts` — `selectBackend(options)` resolver. Precedence: caller `driver` → neo4j; `backend === 'polygraph'` → polygraph; `polygraphPath` set → polygraph; `graphUrl` starts with `bolt://` → neo4j; default → neo4j (preserves Phase 1c default).
- `CommitOptions.backend` and `CommitOptions.polygraphPath` (likewise `ContractsConnection.backend` / `.polygraphPath`).
- `tests/backends-differential.test.ts` — `describe.each` over `[neo4j, polygraph]`, asserts the same input produces the same output for every public function. Neo4j leg is gated on Bolt reachability; PolyGraph leg always runs (embedded leveldb in `os.tmpdir()`, fresh per fixture).
- `polygraph-db` as a `file:`-resolved dependency at `../../polygraph` (Phase 1d v0.1.4 — unchanged here).

### Changed

- `commit-contract.ts` and `query-contracts.ts` refactored to drive all I/O through the `Backend` interface. No more direct `neo4j.driver(...)` / `session.run(...)` calls in those files.
- `verifyContract` re-implemented on top of `backend.native.findNodes` + `backend.native.findRelationships`. The Phase 1c Neo4j-flavored `OPTIONAL MATCH … WITH … count(DISTINCT)` cypher was qengine territory — the native path keeps the verify shape the same across both backends. Returned `{contractId, nodeCount, edgeCount, hasAnchor}` is unchanged.
- `Contract.loadedAt` is now a pre-computed ISO string (`new Date().toISOString()`) instead of cypher `datetime()`. Both backends store it as a string; downstream readers were already string-typing it via `r.get('loadedAt')` so the wire shape didn't change. Provenance JSDoc on the relevant block in `commit-contract.ts`.

### Tests

- `35/35 passing`: 9 parse-events-spine + 9 parse-simple-auth + 4 commit-contract (Neo4j round-trip) + 12 differential (6 cases × 2 backends).
- The Neo4j leg of the differential suite is automatically skipped when the configured Bolt URL is unreachable (matches the events-spine harness pattern from Phase 1a F2).

### Selector rules at a glance

```ts
// Existing Phase 1c callers — unchanged behavior
await commitContract(graph, { namespace: 'asi' });                // → neo4j
await commitContract(graph, { namespace: 'asi', driver });        // → neo4j (caller owns driver)

// Phase 1e additions
await commitContract(graph, { namespace: 'asi', backend: 'polygraph', polygraphPath: '/var/db' });
await commitContract(graph, { namespace: 'asi', polygraphPath: '/var/db' });  // → polygraph (inferred)
```

## 0.1.0-pre.1 — unreleased (rolled into 0.2.0-pre)

### Changed

- `Hypothesis.verifiedAt?: string | null` is now part of the hypothesis surface. Parsed bookend hypotheses default it to `null`; `commitContract` writes it on CREATE; `showContract` reads it back. Phase 1a F1.a.

### Tests

- `parse-events-spine.test.ts` asserts every parsed hypothesis is `open` with `verifiedAt === null` (10 tests, +1).
- `commit-contract.test.ts` adds a round-trip test that flips H6+H7 to `held` with a known ISO timestamp, commits, and reads back via `showContract` (4 tests, +1).

## 0.1.0-pre — 2026-05-21

**Initial release.** Realizes the ArchiMate-flavored SIG ontology in code and PolyGraph for Task 3 of the SIG-first pivot.

- `parseBookend(filePath)` — markdown→`ContractGraph` parser tolerant of LEFT-BOOKEND.md section numbering and parenthetical suffixes
- `commitContract(graph, { namespace })` — idempotent commit, scoped by `contractId + namespace`
- `verifyContract(contractId, namespace)` — round-trip read for tests
- `listContracts(namespace)` / `showContract(archetypeName, namespace)` — read-side helpers for CLI integration
- 21/21 tests: 9 parse-events-spine + 9 parse-simple-auth + 3 commit-contract (round-trip + idempotency + missing-anchor)

See top-level [`CHANGELOG.md`](../CHANGELOG.md) §`0.1.1-pre` for the bigger picture.
