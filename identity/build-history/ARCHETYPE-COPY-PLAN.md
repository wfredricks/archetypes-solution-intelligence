# ARCHETYPE-COPY-PLAN.md — bangauth → SI/I

*Written 2026-05-20 18:55 EDT. Source: `wfredricks/bangauth` at commit `3ae5106`. Destination: `artifacts/si-runtime/identity/src/auth/`. Methodology: archetype (whole-cloth copy + documented modification + provenance tagging + maintenance ownership).*

*This is a mechanical recipe a sub-agent executes. Every file action below is concrete and deterministic. No design decisions to make at execute time — those were made tonight.*

---

## Source pinning

- **Repo:** `https://github.com/wfredricks/bangauth`
- **Commit:** `3ae510649b2450c71099ab1e43d9350bc11d7087`
- **Tag:** none — pin to commit
- **Local path:** `/Users/williamfredricks/.openclaw/workspace/artifacts/bangauth/`

The sub-agent reads from the local path. Every adapted file's provenance header cites the commit hash above.

## Destination

`artifacts/si-runtime/identity/src/auth/` — a subdirectory inside the existing `identity` repo. Not a new repo. Not a peer of `identity`. **Inside** it.

The full `identity` repo structure after this work:

```
si-runtime/identity/
├── ARCHETYPE.md                 ← NEW: ownership doc (see §"Ownership artifact")
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── src/
│   ├── index.ts                 ← MODIFIED: now exports the SI/I public API
│   ├── auth/                    ← NEW DIRECTORY: bangauth archetype lives here
│   │   ├── token.ts             ← Adapted from bangauth/src/token.ts
│   │   ├── domain.ts            ← Adapted from bangauth/src/domain.ts
│   │   ├── email.ts             ← Adapted from bangauth/src/email.ts
│   │   ├── config.ts            ← Adapted from bangauth/src/config.ts
│   │   ├── types.ts             ← Adapted from bangauth/src/types.ts
│   │   ├── server.ts            ← Adapted from bangauth/src/server.ts (heavily; see modifications)
│   │   ├── adapters/
│   │   │   ├── email-console.ts ← Copied verbatim
│   │   │   ├── keys-memory.ts   ← Copied verbatim
│   │   │   └── users-memory.ts  ← Copied verbatim
│   │   ├── _deferred/           ← Files kept but NOT wired in v0.1
│   │   │   ├── mfa-session.ts   ← Copied; not imported
│   │   │   ├── mfa-store.ts     ← Copied; not imported
│   │   │   ├── totp.ts          ← Copied; not imported
│   │   │   ├── recovery.ts      ← Copied; not imported
│   │   │   └── login-page.ts    ← Copied; not imported
│   │   └── __tests__/           ← Adapted tests
│   │       ├── token.test.ts    ← Adapted (payload shape change)
│   │       ├── domain.test.ts   ← Copied verbatim
│   │       ├── email.test.ts    ← Copied verbatim
│   │       └── memory-key-store.test.ts  ← Copied verbatim
│   ├── grants.ts                ← NEW: role-grant ledger
│   ├── resolve.ts               ← NEW: /resolve endpoint logic
│   ├── audit.ts                 ← NEW: chainblocks emission wrapper
│   └── server.ts                ← NEW: SI/I top-level Hono server (composes auth + grants + resolve)
├── tests/
│   ├── smoke.test.ts            ← Already exists; extend to test SI/I composition
│   ├── grants.test.ts           ← NEW
│   ├── resolve.test.ts          ← NEW
│   └── integration.test.ts      ← NEW: end-to-end against running server
├── package.json                 ← MODIFIED (deps + bin)
├── tsconfig.json
├── tsconfig.eslint.json
├── tsup.config.ts               ← MODIFIED (add server entry)
└── vitest.config.ts
```

## Files to drop entirely (NOT copied)

These bangauth files do not get copied at all:

- `src/handlers/` (all 11 files) — Lambda-shaped; `server.ts` already wraps the logic. We use Hono path only.
- `src/twin-id.ts` — bangauth-specific UDT concept (twin id derivation). Not applicable to SI.
- `src/adapters/memory-key-store.ts` — duplicate of `keys-memory.ts`; only one is needed
- `src/adapters/nats-publisher.ts` — NATS pub-sub for bangauth events. SI uses chainblocks for audit instead. Drop.
- `src/index.ts` — bangauth's public API exports; SI/I has its own (different) public API
- `src/__tests__/mfa.test.ts` — MFA deferred; the source file is in `_deferred/` so the test would be irrelevant
- `src/__tests__/recovery.test.ts` — same reason
- `src/__tests__/twin-id.test.ts` — twin-id dropped entirely

## Files copied verbatim (no modifications except header)

These come over byte-for-byte with only an added provenance header comment:

| Bangauth source | SI destination |
|---|---|
| `src/adapters/email-console.ts` | `src/auth/adapters/email-console.ts` |
| `src/adapters/keys-memory.ts` | `src/auth/adapters/keys-memory.ts` |
| `src/adapters/users-memory.ts` | `src/auth/adapters/users-memory.ts` |
| `src/mfa-session.ts` | `src/auth/_deferred/mfa-session.ts` |
| `src/mfa-store.ts` | `src/auth/_deferred/mfa-store.ts` |
| `src/totp.ts` | `src/auth/_deferred/totp.ts` |
| `src/recovery.ts` | `src/auth/_deferred/recovery.ts` |
| `src/login-page.ts` | `src/auth/_deferred/login-page.ts` |
| `src/domain.ts` | `src/auth/domain.ts` |
| `src/email.ts` | `src/auth/email.ts` |
| `src/__tests__/domain.test.ts` | `src/auth/__tests__/domain.test.ts` |
| `src/__tests__/email.test.ts` | `src/auth/__tests__/email.test.ts` |
| `src/__tests__/memory-key-store.test.ts` | `src/auth/__tests__/memory-key-store.test.ts` |

**Note on `_deferred/`:** these are kept for archetype completeness — when we refresh from upstream, we want to refresh the whole module including the parts we're not wiring. The directory name `_deferred` makes the lifecycle status visible in the tree. Each file gets a one-line top-of-file comment: `// Archetype: deferred from SI/I v0.1 wiring; bring online when MFA / browser-flow / recovery is needed.`

## Files copied with modifications

### `src/auth/token.ts` (from bangauth `src/token.ts`)

**Modifications:**

1. **Provenance header** added at top:
   ```ts
   /**
    * Adapted from bangauth — https://github.com/wfredricks/bangauth
    * Source commit: 3ae510649b2450c71099ab1e43d9350bc11d7087
    * Source path: src/token.ts (bangauth v0.1.1)
    *
    * Pattern: HMAC-SHA256 deterministic tokens with monthly key rotation.
    * Adapted for: SI/I identity service, v0.1.
    *
    * Maintenance ownership: SI core team. CVE watch on node:crypto.
    * Upstream refresh policy: review at every SI minor version bump.
    *
    * Modifications from upstream:
    *   - TokenPayload.constellationId renamed to TokenPayload.projectId
    *   - All other behavior preserved
    */
   ```
2. **No code logic changes.** Token generation and verification logic stays identical. The HMAC primitives, the base64url encoding, the monthly key derivation, the grace-period handling — all preserved.

### `src/auth/types.ts` (from bangauth `src/types.ts`)

**Modifications:**

1. **Provenance header** (same format as above; modifications list below).
2. **`TokenPayload.constellationId` → `TokenPayload.projectId`.** Same string field; different name. This is the only semantic change; SI uses `projectId` to scope per-project role grants.
3. **All other types preserved.**

Concretely, before:
```ts
export interface TokenPayload {
  email: string;
  domain: string;
  month: string;
  kid: string;
  alg: string;
  constellationId: string;   // ← old
  version: number;
}
```
After:
```ts
export interface TokenPayload {
  email: string;
  domain: string;
  month: string;
  kid: string;
  alg: string;
  projectId: string;          // ← new (renamed from constellationId)
  version: number;
}
```

### `src/auth/config.ts` (from bangauth `src/config.ts`)

**Modifications:**

1. **Provenance header.**
2. **Env-var name updates:** `BANGAUTH_APP_NAME` → `SI_APP_NAME`, `BANGAUTH_ALLOWED_DOMAINS` → `SI_ALLOWED_DOMAINS`, etc. Anywhere `BANGAUTH_*` appears, rename to `SI_*`.
3. **Drop `BANGAUTH_CONSTELLATION_ID`** if it exists; add equivalent `SI_PROJECT_ID` if needed.

### `src/auth/email.ts` (from bangauth `src/email.ts`)

**Modifications:**

1. **Provenance header.**
2. **User-facing email body text:** any reference to "BangAuth" → "Solution Intelligence" (or just "SI"). The login email a user receives should say something like:
   > Subject: Your SI access code
   > Body: Your access code for Solution Intelligence is: 123456 ...
3. **No protocol changes.**

### `src/auth/server.ts` (from bangauth `src/server.ts` — HEAVY MODIFICATIONS)

This is the most-modified file. **It is no longer the top-level entry point** — see §"New files" below for `src/server.ts` which composes auth + grants + resolve. This `src/auth/server.ts` becomes a *Hono router* that's mounted under `/auth` in the top-level server.

**Modifications:**

1. **Provenance header** with notes that this file diverges substantially from upstream.
2. **Drop imports for MFA, TOTP, recovery, login-page** — those files are in `_deferred/` and not wired in v0.1.
3. **Drop the four MFA routes** (`/auth/mfa/enroll`, `/auth/mfa/verify`) and the recovery routes — not in v0.1.
4. **Drop the HTML login page route** (`/auth/login` GET) — CLI-only login per Decision 4.
5. **Keep the two core routes:**
   - `POST /auth/request-code` — issue an access code via email
   - `POST /auth/verify-code` — verify the code, issue a token
6. **Keep `GET /auth/.well-known/jwks.json`** — needed for SI/W and SI/S to verify tokens locally if they choose.
7. **Change the token issuance step:** when `verify-code` succeeds, the response includes `{ authenticated: true, email, token }` (drop the `twinId` field; that's bangauth-specific). The token shape is the modified `TokenPayload` from `src/auth/types.ts`.
8. **Export the Hono router instance** (not the server) so the top-level `src/server.ts` can mount it.

### `src/auth/__tests__/token.test.ts` (from bangauth `src/__tests__/token.test.ts`)

**Modifications:**

1. **Provenance header.**
2. **Wherever the test asserts `payload.constellationId`, change to `payload.projectId`.** Wherever the test calls `generateToken({...constellationId: 'x'...})`, change to `generateToken({...projectId: 'x'...})`.
3. **No behavioral test changes** — the crypto behavior is unchanged.

## New files (not from bangauth)

These are pure SI additions. The archetype provides the primitives; SI/I composes them.

### `src/index.ts` — modified

Replace the current scaffold-only `VERSION` export with:

```ts
export { VERSION } from './version.js';
export { startServer } from './server.js';
// Public types if any callers need them (likely none in v0.1)
export type { Role, RoleGrant, ResolveResponse } from './types.js';
```

Move the current `VERSION` constant into a new `src/version.ts` file. Bump it from `0.1.0-pre` to `0.2.0-pre` (Stage 2 deliverable; bump per SemVer-pre convention).

### `src/types.ts` — NEW (different file from `src/auth/types.ts`)

SI/I's public types, separate from the auth archetype's internal types:

```ts
export type Role = 'Owner' | 'Operator' | 'Analyst' | 'Reviewer' | 'Customer';

export interface RoleGrant {
  grantId: string;        // e.g. "g_01HX..."
  projectId: string;
  userId: string;
  role: Role;
  grantedBy: string;      // userId of the granting Owner
  grantedAt: string;      // ISO-8601 UTC
  revoked: boolean;
  revokedBy: string | null;
  revokedAt: string | null;
  auditBlock: number;     // chainblocks seq
}

export interface ResolveResponse {
  userId: string;
  displayName: string;
  effectiveRoles: Role[];
}
```

Schemas follow MODEL.md §6.2 exactly.

### `src/grants.ts` — NEW

The role-grant ledger. JSONL at `<project>/data/identity/grants.jsonl` (mode 0600). Pure SI logic; no bangauth involvement.

Exports:
- `async appendGrant(g: Omit<RoleGrant, 'grantId' | 'grantedAt' | 'revoked' | 'revokedBy' | 'revokedAt' | 'auditBlock'>, auditBlock: number): Promise<RoleGrant>` — append a new grant
- `async appendRevoke(grantId: string, revokedBy: string, auditBlock: number): Promise<RoleGrant>` — append a revocation (writes a new line marking the grant revoked; never mutates an existing line)
- `async effectiveRoles(userId: string, projectId: string): Promise<Role[]>` — read all grants, filter to non-revoked + matching user + matching project, return unique roles
- `async listGrants(projectId?: string): Promise<RoleGrant[]>` — for admin / debug

Append-only contract enforced via:
- Open with `fs.open(path, 'a')` (append-only file descriptor)
- Each line is a complete RoleGrant JSON object
- Reads use streaming JSONL parser; entire file replay on every call (cheap for v0.1; cache later if needed)

### `src/resolve.ts` — NEW

The `/resolve` endpoint logic. Takes a token, verifies via `src/auth/token.ts`'s `verifyToken`, queries `src/grants.ts` for `effectiveRoles`, returns `ResolveResponse`.

Plus a CLI-callable function for testing without HTTP.

### `src/audit.ts` — NEW

Chainblocks emission wrapper. Encapsulates how SI/I writes audit events.

In v0.1: a thin wrapper that calls into chainblocks library if available, falls back to writing a JSONL audit-trail at `<project>/data/chainblocks/si.audit.jsonl` if not.

(Stage 2 doesn't require *real* chainblocks integration — that's Stage 2c or a polish pass — but the wrapper is here from the start so subsequent code calls a stable interface. The wrapper produces the canonical payload shape per MODEL.md §3.1 + §3.2 for `si.role.granted` and `si.role.revoked`.)

Exports:
- `async emitGrantEvent(payload: { actor, projectId, targetUserId, role }): Promise<number>` — returns the audit-block seq number
- `async emitRevokeEvent(payload: { actor, projectId, targetUserId, role }): Promise<number>`

### `src/server.ts` — NEW (top-level Hono server for SI/I)

Composes everything:

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRouter } from './auth/server.js';
import { resolveHandler } from './resolve.js';
import { grantHandler, revokeHandler } from './grants-http.js';

const app = new Hono();

// Mount the bangauth archetype under /auth
app.route('/auth', authRouter);

// SI/I's own endpoints
app.post('/resolve', resolveHandler);
app.post('/grants', grantHandler);
app.post('/grants/:grantId/revoke', revokeHandler);
app.get('/grants', listGrantsHandler);

app.get('/health', (c) => c.json({ ok: true, service: 'si-identity', version: VERSION }));

export function startServer(port = 3001) { return serve({ fetch: app.fetch, port }); }
```

### `src/grants-http.ts` — NEW

HTTP handlers for grant/revoke operations. Thin layer over `src/grants.ts` + `src/audit.ts`. Calls `appendGrant` + `emitGrantEvent` atomically (one fails → both fail).

### Tests

- `tests/grants.test.ts` — unit tests for `src/grants.ts` (append, revoke, effectiveRoles, append-only invariant)
- `tests/resolve.test.ts` — unit tests for `src/resolve.ts` (valid token → response; invalid token → 401; expired token → 401)
- `tests/integration.test.ts` — end-to-end: start server, request-code, verify-code, grant, resolve, revoke, resolve again, verify revocation took effect

### `tests/smoke.test.ts` — modified

Extend the existing scaffold smoke test:
- Keep `VERSION` assertion
- Add: `import('./server.js')` doesn't throw
- Add: `startServer(0)` returns a server, then `close()` it cleanly

## Package.json modifications

```json
{
  "version": "0.2.0-pre",
  "description": "SI/I — Solution Intelligence identity service. Wraps the bangauth archetype (passwordless email-and-code authentication with monthly-rotating HMAC tokens) and adds SI's 5-role permission matrix per MODEL.md §6.",
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "start": "node dist/server.js",
    ...
  },
  "dependencies": {
    "@hono/node-server": "^2.0.2",
    "hono": "^4.0.0",
    "yaml": "^2.6.1"
  },
  "devDependencies": {
    ... (preserve existing devDependencies from Stage 1b)
  }
}
```

**Drop `nats` dep.** Bangauth uses it for event publishing; SI uses chainblocks for audit. No NATS in SI/I.

**Drop AWS deps if they snuck in via bangauth handler files** — we're not bringing the handlers.

## `tsup.config.ts` modifications

Add `src/server.ts` as an entry point alongside `src/index.ts`:

```ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
});
```

## CHANGELOG.md update

Add to `## [Unreleased]` (or rename it to `## [0.2.0-pre] — 2026-05-20`):

```
### Added

- **SI/I identity service** — Stage 2a deliverable. Per MODEL.md §6.
- **Bangauth archetype integration** — passwordless email-and-code authentication with monthly-rotating HMAC-SHA256 tokens. Sourced from `wfredricks/bangauth@3ae5106` and brought into the SI codebase via the archetype methodology (whole-cloth copy + documented modification + provenance tagging). See `ARCHETYPE.md`.
- **Role-grant ledger** — append-only JSONL at `<project>/data/identity/grants.jsonl`. Append + revoke operations are idempotent and per-grant.
- **`POST /resolve`** — token → `{ userId, displayName, effectiveRoles[] }` for use by SI/S and SI/W.
- **`POST /grants` and `POST /grants/:grantId/revoke`** — Owner-gated; emit `si.role.granted` and `si.role.revoked` audit events.
- **Audit emission wrapper** — produces canonical chainblocks payloads per MODEL.md §3.2.

### Architectural notes

- **Archetype, not dependency.** Bangauth's source is integrated into SI/I's `src/auth/` directory rather than imported as a package. Refresh policy and maintenance ownership: see `ARCHETYPE.md`. This reduces SI's third-party-dependency surface for ATO purposes.
- **MFA, recovery, and browser-flow login deferred to v0.2.** Source files are kept under `src/auth/_deferred/` for archetype completeness; not wired into v0.1's `/auth/*` routes.
```

## Ownership artifact: `ARCHETYPE.md`

NEW file at `artifacts/si-runtime/identity/ARCHETYPE.md`:

```markdown
# Archetype Manifest — SI/I

This document declares the archetype methodology adoptions inside `@solution-intelligence/identity`. An archetype is third-party code (or first-party code from a separate project) brought into this repo whole-cloth and adopted with full local ownership — *not* imported as a runtime dependency.

## Why archetype, not dependency

This pattern is adopted for the SI runtime because:

1. **ATO / FedRAMP scope reduction.** Each runtime dependency expands the supply-chain attestation surface an assessor must reason about. Archetypes collapse that surface into SI's own code, with documented provenance.
2. **Sovereignty over critical components.** Identity, audit, and graph primitives are security-critical. Inheriting upstream's pace, scope, and roadmap for these is undesirable.
3. **AI-flattened maintenance cost.** With AI-assisted code work, the cost of periodically refreshing from upstream (whole-cloth copy + re-applying our documented modifications) is comparable to the cost of `npm update`. The historical trade — convenience vs. control — has shifted toward control.

## Adopted archetypes

### bangauth → `src/auth/`

| Field | Value |
|---|---|
| **Source repo** | `https://github.com/wfredricks/bangauth` |
| **Source commit** | `3ae510649b2450c71099ab1e43d9350bc11d7087` |
| **Source version** | bangauth v0.1.1 |
| **Adopted on** | 2026-05-20 |
| **Pattern** | Passwordless authentication with monthly-rotating HMAC-SHA256 tokens (the "Bang" pattern: deterministic per-user codes derived from `SHA-256(email + YYYY-MM + secret)`; no password database; codes self-expire monthly) |

**Files adopted** (provenance headers in each file cite this commit):
- `src/auth/token.ts`, `src/auth/types.ts`, `src/auth/domain.ts`, `src/auth/email.ts`, `src/auth/config.ts`
- `src/auth/server.ts` (heavily modified — MFA/recovery routes dropped; CLI-only flow)
- `src/auth/adapters/` (verbatim)
- `src/auth/_deferred/` (kept for archetype completeness; not wired in v0.1)
- `src/auth/__tests__/` (adapted tests)

**Modifications from upstream** (full diff in commit history):
- `TokenPayload.constellationId` → `TokenPayload.projectId` (semantic rename for SI's per-project scoping)
- All `BANGAUTH_*` env vars → `SI_*`
- All "BangAuth" user-facing strings → "Solution Intelligence" / "SI"
- MFA, recovery, browser-flow login, NATS publisher dropped from v0.1 wiring (source files preserved under `_deferred/`)
- Lambda handlers dropped (Hono server is the only entry point)
- `twin-id.ts` dropped entirely (bangauth-specific concept)

**Refresh policy:** Review upstream at every SI minor-version bump (~quarterly). Emergency-refresh on:
- Critical CVE in `node:crypto` or HMAC implementation
- Critical security advisory on bangauth itself
- A bangauth feature that would materially improve SI's identity story

**Refresh procedure:**
1. Pin new upstream commit
2. Whole-cloth re-copy the adopted file set into a `src/auth.new/` directory
3. Re-apply the documented modifications (this file's diff list is the recipe)
4. Diff `src/auth.new/` against `src/auth/`; surface any new upstream changes for review
5. Adopt or reject per change; update this file's modifications list
6. Replace `src/auth/` with `src/auth.new/`
7. Run full test suite
8. Bump SI minor version

**Maintenance ownership:** SI core team (one person in v0.1: @wfredricks).

**Intended controls satisfied** (NIST 800-53 Rev. 5 mapping):
- AC-2 (Account Management) — account state in bangauth's user store; lifecycle via grant/revoke flow
- AC-3 (Access Enforcement) — role check at `/resolve` endpoint; enforced by every consuming service
- AU-2 (Audit Events) — `si.role.granted` / `si.role.revoked` events emitted via chainblocks
- AU-3 (Content of Audit Records) — payload schemas per MODEL.md §3.2
- IA-2 (Identification and Authentication) — passwordless email-and-code flow
- IA-5 (Authenticator Management) — monthly key rotation built into the token derivation; 3-day grace period for cross-month transition
```

## Sub-agent execution order

The sub-agent runs these steps in order. **One step at a time; verify each gate before proceeding.**

### Phase A: Setup

1. `cd /Users/williamfredricks/.openclaw/workspace/artifacts/si-runtime/identity`
2. Confirm Stage 1b scaffold state: `git log --oneline -3` should show the v0.1.0-pre commit
3. Create branch: `git checkout -b stage-2a`

### Phase B: Vendor the archetype

4. Create directories: `mkdir -p src/auth/adapters src/auth/_deferred src/auth/__tests__`
5. Copy verbatim files per §"Files copied verbatim" (10 files). For each copied file:
   - Read source from `/Users/williamfredricks/.openclaw/workspace/artifacts/bangauth/<source-path>`
   - Prepend the provenance header (template in §"Modified files" — adjust the modifications list to "none — copied verbatim")
   - Write to destination

6. Copy and modify the 6 modified files per §"Files copied with modifications":
   - `token.ts` (provenance + no logic changes)
   - `types.ts` (constellationId → projectId)
   - `domain.ts` (provenance only; no changes)
   - `email.ts` (provenance + user-facing string replacements)
   - `config.ts` (provenance + env var renames)
   - `server.ts` (HEAVY: drop MFA/recovery/login-page imports + routes; keep 3 routes; export router instead of server)
   - `__tests__/token.test.ts` (provenance + payload field rename in assertions)

7. Verify the archetype tests pass in isolation: `cd src/auth && npx vitest run __tests__/`
   - If `domain.test.ts` or `email.test.ts` fail, surface immediately — the verbatim copies were supposed to keep their semantics
   - `token.test.ts` should pass after the field rename

### Phase C: SI/I additions

8. Write `src/version.ts` with the bumped version `0.2.0-pre`
9. Write `src/types.ts` with the SI-public types (Role, RoleGrant, ResolveResponse)
10. Write `src/grants.ts` per spec
11. Write `tests/grants.test.ts` and verify it passes
12. Write `src/audit.ts` per spec (v0.1 wrapper; real chainblocks integration deferred)
13. Write `src/resolve.ts` per spec
14. Write `tests/resolve.test.ts` and verify
15. Write `src/grants-http.ts`
16. Write `src/server.ts` (top-level composition)
17. Write `tests/integration.test.ts` and verify (this is the load-bearing test — full server flow)
18. Rewrite `src/index.ts` per spec
19. Extend `tests/smoke.test.ts` per spec

### Phase D: Repo metadata

20. Update `package.json` per spec (version, description, scripts, deps)
21. Update `tsup.config.ts` per spec (add server entry)
22. Update `CHANGELOG.md` per spec
23. Write `ARCHETYPE.md` per spec

### Phase E: Gates

24. `npm install` succeeds
25. `npm run typecheck` (or `npm run build` if typecheck script doesn't exist) — clean
26. `npm run lint` — clean
27. `npm test` — all green
28. `npm run build` — `dist/` produced; both `index.js` and `server.js` exist
29. Smoke-test the server: `node dist/server.js &` then `curl http://localhost:3001/health` — expect `{ok:true,service:"si-identity"...}`

### Phase F: Commit + push

30. `git add -A`
31. `git commit -m "Stage 2a: SI/I identity service (bangauth archetype + grants + resolve + audit)"`
32. `git push origin stage-2a`
33. Open PR via `gh pr create --base main --title "Stage 2a: SI/I identity service" --body "@archetype: bangauth@3ae5106. See ARCHETYPE.md for provenance + modifications + refresh policy. Closes Stage 2a per BUILD-PLAN.md."`
34. Wait for CI green via `gh run watch`
35. Merge with `gh pr merge --squash` (or leave for orchestrator review — sub-agent's call based on whether CI is green)

### Phase G: Findings

36. Write `build-history/BUILD-STAGE-02A-FINDINGS.md` with:
   - What was adopted (5-line summary)
   - Any defects discovered in bangauth's source during adoption (e.g. typos, dead code, unclear behavior)
   - Any places where MODEL.md and bangauth diverged and how the adaptation reconciled them
   - Test coverage delta (before/after)
   - Wall-clock time per phase
   - Recommendations for Stage 2b (CLI commands)

37. Final 10-line status summary to Bill via Signal at +17176608721 (use the `message` tool, channel `signal`).

## Hard constraints

- **Do NOT modify the bangauth repo itself.** Read-only. Adaptation happens at the SI side; bangauth stays clean.
- **Do NOT skip the provenance headers.** Every adapted file must carry one. The audit trail is the methodology.
- **Do NOT batch all files into one write call.** Per-file writes; verify each file lands cleanly before moving on. This avoids the per-turn output budget failure from Stage 1.
- **Do NOT use `/tmp/`** for staging. Everything in the workspace tree.
- **Do NOT publish to npm.** SI/I stays unpublished in Stage 2a.
- **Do NOT delete any `_deferred/` files at any phase.** They're load-bearing for archetype completeness even though they're not wired.
- **If a content filter blocks output mid-stream**, surface explicitly. Don't silent-retry.
- **If `npm test` reveals a pre-existing failure in bangauth's tests** (post-modification), surface it — that's a real finding for `ARCHETYPE.md`'s "defects discovered" list.

## Time budget

Target: 90-150 minutes wall-clock. If you exceed 180 minutes, stop and report.

## Output expected at the end

1. PR open (or merged) for `stage-2a` on `wfredricks/solution-intelligence-identity` with all artifacts
2. CI green
3. `BUILD-STAGE-02A-FINDINGS.md` written
4. `ARCHETYPE.md` written
5. Signal message to Bill with status summary
