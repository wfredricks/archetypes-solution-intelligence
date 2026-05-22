# Changelog

## [Unreleased]

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
