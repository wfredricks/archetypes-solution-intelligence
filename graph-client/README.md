# @solution-intelligence/graph-client 🖇️

**SI/GC — typed HTTP client for the Solution Intelligence Graph (SI/G).**

![version](https://img.shields.io/badge/version-0.1.0--pre-orange)
![status](https://img.shields.io/badge/status-Stage%202c%20scaffold-yellow)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)

Part of [Solution Intelligence v0.1](https://github.com/wfredricks/solution-intelligence). This package is the typed client that other SI components — the cli, the studio, GraphLoader, and downstream services — use to talk to SI/G.

## Status

**Stage 2c — `0.1.0-pre` — scaffold only.**

This repository was created as pre-work for Stage 3 (Graph + GraphLoader). Right now it contains:

- The package skeleton (`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, lint + format config).
- An empty `src/index.ts` re-export with a JSDoc header explaining the intent.
- A single smoke test that asserts the build/test pipeline works.
- CI on Node 20.x and 22.x running lint, typecheck, test, coverage.

Stage 3 will fill in the actual client implementation:

- `SIGraphClient` — modeled on `SIIdentityClient` (see [`@solution-intelligence/cli`](https://github.com/wfredricks/solution-intelligence-cli/blob/main/src/http.ts)).
- A shared `SIHttpError` shape (originally introduced in the cli for SI/I; will be lifted here when both clients need it).
- Typed responses for graph endpoints: node/edge CRUD, traversal queries, audit-block linkage.
- Bearer-token wiring against the cli's `~/.si/credentials` store (no direct file access; the client accepts a token + URL from the caller).

## Why a separate package

The graph-client is split out from the cli for the same reason `@solution-intelligence/identity` is its own package: the audit, identity, and graph surfaces are independently consumed. The cli depends on graph-client; so will the studio, the GraphLoader, and other downstream tools. Keeping the client in its own package avoids forcing every consumer to take a dependency on commander, the credentials store, and the rest of the cli surface area.

## Archetype methodology

This package follows the same archetype methodology that SI/I adopted from bangauth (see [`identity/ARCHETYPE.md`](https://github.com/wfredricks/solution-intelligence-identity/blob/main/ARCHETYPE.md)). For Stage 2c, no upstream archetypes have been adopted — the file [`ARCHETYPE.md`](./ARCHETYPE.md) is a placeholder pointing at the canonical example. Stage 3 will either:

- Declare new archetypes (if any of the graph-client patterns come from an external source), or
- Note that all code is first-party SI-original (in which case ARCHETYPE.md documents that fact and the maintenance ownership).

## Hard rules carried forward from the runtime

These constraints apply to every package in the SI runtime, and they continue to apply here once Stage 3 ships code:

- Mode 0600 on any on-disk artifact the client writes.
- Atomic writes (`*.tmp.<rand>` → `fs.rename`) for any persistent store.
- Never log tokens, codes, or secret material — including in error messages.
- No `/tmp/` references in tests; use `os.tmpdir()` / `fs.mkdtemp` only.
- `SIHttpError` (or its successor) surfaces server-side `error` strings verbatim and never includes request bodies.

## Install

Not yet published. Stage 3 will publish to GitHub releases (tags only — no npm publish during the pre-1.0 window).

## License

Apache-2.0. See [LICENSE](https://github.com/wfredricks/solution-intelligence-cli/blob/main/LICENSE) on the cli repo for the canonical text (the same license applies across all SI runtime packages).
