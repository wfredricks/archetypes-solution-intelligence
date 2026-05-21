# Changelog

All notable changes to `@solution-intelligence/graph-client` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0-pre — 2026-05-21

### Added

- Initial repository scaffold (Stage 2c pre-work for Stage 3).
- Package skeleton: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, ESLint + Prettier config.
- Empty `src/index.ts` re-export with intent-documented JSDoc header.
- Single smoke test (`tests/smoke.test.ts`) asserting the build/test pipeline works.
- `ARCHETYPE.md` placeholder pointing at the canonical example in `solution-intelligence-identity`.
- CI workflow (`.github/workflows/ci.yml`) running lint, typecheck, test, and coverage on Node 20.x and 22.x.

### Notes

Scaffold only. Stage 3 lands the graph client implementation — `SIGraphClient`, `SIHttpError`, typed responses for graph endpoints, and the wiring to the cli's credentials store.
