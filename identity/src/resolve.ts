/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/resolve.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - @adopt:composes:identity ANSWERED → simple-auth (default kept;
 *     marker preserved as historical documentation)
 *   - Docstring refers to ASI services (formerly SI services)
 */

/**
 * ASI/I — `/resolve` Endpoint Logic
 *
 * // Why: Every ASI service hands a bearer token to /resolve and expects a
 * // `ResolveResponse` back. This file is the pure logic for that path:
 * // verify the token via the bangauth archetype's `verifyToken`, consult
 * // the role-grant ledger via `src/grants.ts`, return effective roles for
 * // the resolved project. The HTTP wrapper lives in `src/server.ts`.
 *
 * @module resolve
 */

import type { Context } from 'hono';
// @adopt:composes:identity
// Q: Which identity archetype does this project compose?
// Default: simple-auth (verifyToken + getAuthKeyStore are bangauth-derived).
// ANSWER:  simple-auth (default kept).
// Reference: archetypes/simple-auth/ARCHETYPE.md
// Notes: /resolve is the canonical "token → userId + roles" endpoint every
//        downstream ASI service hits. The identity contract on this side is
//        narrow: a verify function that returns the email and projectId
//        encoded into the token, plus the matching key store.
import { verifyToken } from './auth/token.js';
import { getAuthKeyStore } from './auth/server.js';
import { effectiveRoles } from './grants.js';
import type { ResolveResponse } from './types.js';

// ─── Pure (no-HTTP) resolver ─────────────────────────────────────────────────

/**
 * Resolution result discriminated union.
 *
 * // Why: Lets the HTTP handler convert success vs. failure into 200 vs. 401
 * // without throwing exceptions, and lets the unit tests assert on the
 * // structured failure reason directly.
 */
export type ResolveOutcome =
  | { ok: true; response: ResolveResponse }
  | { ok: false; status: 401 | 400; reason: string };

/**
 * Resolve a token to a `ResolveResponse` without any HTTP plumbing.
 *
 * // Why: Tests call this directly. The HTTP handler is a one-liner around it.
 *
 * @param token The full bearer token issued by `/auth/verify-code`.
 */
export async function resolveToken(token: string): Promise<ResolveOutcome> {
  if (!token || typeof token !== 'string') {
    return { ok: false, status: 400, reason: 'Token is required' };
  }

  const result = await verifyToken(token, getAuthKeyStore());
  if (!result.valid) {
    return { ok: false, status: 401, reason: result.reason };
  }

  const roles = await effectiveRoles(result.email, result.projectId);

  const response: ResolveResponse = {
    userId: result.email,
    // Why: v0.1 echoes the email as displayName. Richer profile data (name,
    // org, avatar) arrives in v0.2 alongside the SSM-backed user store.
    displayName: result.email,
    effectiveRoles: roles,
  };

  return { ok: true, response };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

interface ResolveBody {
  token?: string;
}

/**
 * Hono handler for `POST /resolve`.
 *
 * Accepts:
 *   - `Authorization: Bearer <token>` header (preferred), or
 *   - `{ token: "..." }` JSON body (for clients that can't set headers).
 *
 * // Why: Two intake shapes so machine clients (CLI, tests) and browser-ish
 * // clients can both call cleanly without negotiating a header policy first.
 */
export async function resolveHandler(c: Context) {
  let token: string | undefined;

  const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    try {
      const body = (await c.req.json()) as ResolveBody;
      token = body.token;
    } catch {
      // Why: An empty body is fine when the header carried the token; surface
      // a 400 only if both header and body are absent.
    }
  }

  if (!token) {
    return c.json({ error: 'Token is required' }, 400);
  }

  const outcome = await resolveToken(token);
  if (!outcome.ok) {
    return c.json({ error: outcome.reason }, outcome.status);
  }
  return c.json(outcome.response);
}
