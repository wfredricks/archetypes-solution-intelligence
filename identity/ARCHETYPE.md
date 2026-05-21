# Archetype Manifest — SI/I

This document declares the archetype methodology adoptions inside
`@solution-intelligence/identity`. An archetype is third-party code (or
first-party code from a separate project) brought into this repo whole-cloth
and adopted with full local ownership — *not* imported as a runtime
dependency.

## Why archetype, not dependency

This pattern is adopted for the SI runtime because:

1. **ATO / FedRAMP scope reduction.** Each runtime dependency expands the
   supply-chain attestation surface an assessor must reason about. Archetypes
   collapse that surface into SI's own code, with documented provenance.
2. **Sovereignty over critical components.** Identity, audit, and graph
   primitives are security-critical. Inheriting upstream's pace, scope, and
   roadmap for these is undesirable.
3. **AI-flattened maintenance cost.** With AI-assisted code work, the cost of
   periodically refreshing from upstream (whole-cloth copy + re-applying our
   documented modifications) is comparable to the cost of `npm update`. The
   historical trade — convenience vs. control — has shifted toward control.

## Adopted archetypes

### bangauth → `src/auth/`

| Field | Value |
|---|---|
| **Source repo** | `https://github.com/wfredricks/bangauth` |
| **Source commit** | `3ae510649b2450c71099ab1e43d9350bc11d7087` |
| **Source version** | bangauth v0.1.1 |
| **Adopted on** | 2026-05-20 (Stage 2a) |
| **Pattern** | Passwordless authentication with monthly-rotating HMAC-SHA256 tokens (the "Bang" pattern: deterministic per-user codes derived from `SHA-256(email + YYYY-MM + secret)`; no password database; codes self-expire monthly) |

**Files adopted** (provenance headers in each file cite this commit):

- `src/auth/token.ts`, `src/auth/types.ts`, `src/auth/domain.ts`
- `src/auth/server.ts` (heavily modified — MFA/recovery/HTML-login routes
  dropped; CLI-only flow; emits a router rather than a server)
- `src/auth/adapters/email-console.ts` (verbatim)
- `src/auth/adapters/keys-memory.ts` (verbatim)
- `src/auth/adapters/users-memory.ts` (verbatim)
- `src/auth/adapters/memory-key-store.ts` (verbatim — test fixture; keeps the
  upstream `memory-key-store.test.ts` working without rewiring)
- `src/auth/_deferred/` — files kept for archetype completeness but not
  wired in v0.1 (excluded from compile/lint):
  - `mfa-session.ts`, `mfa-store.ts`, `totp.ts`, `recovery.ts`,
    `login-page.ts`
  - `email.ts` (SES-backed sender; v0.1 uses `ConsoleEmailAdapter`)
  - `config.ts` (SSM + Secrets Manager loader; v0.1 uses env-var
    `loadAuthConfig`)
- `src/auth/__tests__/` — adapted tests (`token.test.ts`, `domain.test.ts`,
  `email.test.ts`, `memory-key-store.test.ts`)

**Files explicitly NOT adopted** (and why):

- `src/handlers/*` — Lambda-shaped; SI/I uses Hono only.
- `src/twin-id.ts` and `src/__tests__/twin-id.test.ts` — bangauth's
  UDT-specific "twin id" concept; not part of SI's domain model.
- `src/adapters/nats-publisher.ts` — bangauth uses NATS for event
  publishing; SI uses chainblocks for audit and does not need a second event
  bus.
- `src/index.ts` — bangauth's public API; SI/I has its own (different)
  public API at `src/index.ts`.
- `src/__tests__/mfa.test.ts`, `src/__tests__/recovery.test.ts` — the
  underlying source is deferred; the tests are not portable to v0.1.

**Modifications from upstream** (each adapted file carries a provenance
header documenting its specific diff; this is the recipe to re-apply on
refresh):

1. **Semantic rename.** `TokenPayload.constellationId` →
   `TokenPayload.projectId` everywhere — in `types.ts`, `token.ts`, the
   `verifyToken` result, the `generateToken` parameter, and the
   `token.test.ts` assertions. SI uses `projectId` to scope role grants per
   MODEL.md §6.
2. **Env-var rename.** All `BANGAUTH_*` env vars are now `SI_*` (e.g.
   `BANGAUTH_APP_NAME` → `SI_APP_NAME`, `BANGAUTH_ALLOWED_DOMAINS` →
   `SI_ALLOWED_DOMAINS`, `BANGAUTH_APP_ID` → `SI_PROJECT_ID`,
   `BANGAUTH_DEV_CODE` → `SI_DEV_CODE`, `BANGAUTH_PORT` → `SI_PORT`,
   `BANGAUTH_SUPPORT_EMAIL` → `SI_SUPPORT_EMAIL`,
   `BANGAUTH_API_BASE_URL` / `BANGAUTH_REDIRECT_URL` →
   `SI_LOGIN_URL`).
3. **User-facing string updates.** "BangAuth" → "Solution Intelligence" /
   "SI" in adapter banner text. Email-template HTML is in the
   `_deferred/email.ts` file and remains upstream as-is until v0.2.
4. **Routes removed from `auth/server.ts`.** MFA enroll/verify, recovery,
   HTML login page (`GET /auth/login`), and the catch-all redirect dropped.
5. **`auth/server.ts` no longer top-level.** It exports the Hono router
   (`authRouter`) plus two accessors (`getAuthKeyStore`, `getAuthConfig`).
   The top-level server lives in `src/server.ts` and mounts the router
   under `/auth`.
6. **NATS publisher dropped from the server wiring.** Audit events flow
   through `src/audit.ts` (chainblocks wrapper).
7. **`twin-id` and the `twinId` response field dropped from
   `/auth/verify-code`.** Response shape simplified to
   `{ authenticated, email, token }`.
8. **Side effects removed at import time.** Boot banner and signal
   handlers moved to `src/server.ts`'s direct-invocation guard; importing
   `auth/server.ts` binds nothing.

**Refresh policy:** Review upstream at every SI minor-version bump
(~quarterly). Emergency-refresh on:

- Critical CVE in `node:crypto` or HMAC implementation
- Critical security advisory on bangauth itself
- A bangauth feature that would materially improve SI's identity story

**Refresh procedure:**

1. Pin the new upstream commit.
2. Whole-cloth re-copy the adopted file set into a `src/auth.new/` directory.
3. Re-apply the documented modifications above (this file is the recipe).
4. Diff `src/auth.new/` against `src/auth/`; surface any new upstream
   changes for review.
5. Adopt or reject per change; update this file's modifications list.
6. Replace `src/auth/` with `src/auth.new/`.
7. Run the full test suite.
8. Bump the SI minor version.

**Maintenance ownership:** SI core team (one person in v0.2.0-pre:
@wfredricks).

**Intended controls satisfied** (NIST 800-53 Rev. 5 mapping):

- **AC-2 (Account Management)** — account state held in bangauth's
  in-memory user store; lifecycle via the SI grant/revoke flow.
- **AC-3 (Access Enforcement)** — role check at `/resolve`; enforced by
  every consuming service.
- **AU-2 (Audit Events)** — `si.role.granted` / `si.role.revoked` events
  emitted via `src/audit.ts` (chainblocks wrapper).
- **AU-3 (Content of Audit Records)** — payload schemas per MODEL.md §3.2;
  cross-referenced to ledger rows via `auditBlock`.
- **IA-2 (Identification and Authentication)** — passwordless
  email-and-code flow.
- **IA-5 (Authenticator Management)** — monthly key rotation built into
  the token derivation; 3-day grace period for cross-month transition.
