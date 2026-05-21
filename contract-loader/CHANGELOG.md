# Changelog

## 0.1.0-pre — 2026-05-21

**Initial release.** Realizes the ArchiMate-flavored SIG ontology in code and PolyGraph for Task 3 of the SIG-first pivot.

- `parseBookend(filePath)` — markdown→`ContractGraph` parser tolerant of LEFT-BOOKEND.md section numbering and parenthetical suffixes
- `commitContract(graph, { namespace })` — idempotent commit, scoped by `contractId + namespace`
- `verifyContract(contractId, namespace)` — round-trip read for tests
- `listContracts(namespace)` / `showContract(archetypeName, namespace)` — read-side helpers for CLI integration
- 21/21 tests: 9 parse-events-spine + 9 parse-simple-auth + 3 commit-contract (round-trip + idempotency + missing-anchor)

See top-level [`CHANGELOG.md`](../CHANGELOG.md) §`0.1.1-pre` for the bigger picture.
