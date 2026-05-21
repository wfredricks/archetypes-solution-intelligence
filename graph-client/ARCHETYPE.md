# Archetype Manifest — SI/GC (graph-client)

This document declares the archetype methodology adoptions inside
`@solution-intelligence/graph-client`.

For the canonical explanation of the archetype methodology — what it is, why
it exists, and the refresh-policy template — see the SI/I manifest:

> https://github.com/wfredricks/solution-intelligence-identity/blob/main/ARCHETYPE.md

## Status — Stage 2c

**No archetypes adopted yet.** This package is scaffold-only at v0.1.0-pre.
Stage 3 will land the implementation and at that point this file is updated
with one of two outcomes:

1. **Archetype adopted.** If any portion of the graph-client is taken
   whole-cloth from a separate first-party project or third-party source,
   that adoption is recorded here using the same shape as
   [`solution-intelligence-identity/ARCHETYPE.md`](https://github.com/wfredricks/solution-intelligence-identity/blob/main/ARCHETYPE.md):
   source repo + commit + version, files adopted, files explicitly not
   adopted, documented modifications, refresh policy, intended NIST
   controls satisfied.

2. **All first-party SI-original code.** If Stage 3 ships graph-client as
   SI-original code (likely outcome — the most reusable pattern is the
   `SIHttpError` shape from the cli, which is itself already SI-original),
   this file documents that fact: no upstream provenance, SI core team
   ownership, no refresh procedure required.

In either outcome, the runtime-wide hard rules continue to apply (mode 0600
on persistent artifacts, atomic writes, no token logging, no `/tmp/` in
tests).

## Cross-references

- Canonical archetype example: `solution-intelligence-identity/ARCHETYPE.md`
- bangauth → SI/I provenance (the only adoption in the runtime today):
  documented in the same file at the link above.

**Maintenance ownership:** SI core team (one person in v0.1.0-pre:
@wfredricks).
