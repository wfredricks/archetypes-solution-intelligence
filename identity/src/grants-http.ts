/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/grants-http.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - @adopt:composes:audit-ledger ANSWERED → simple-ledger via ./audit.js
 *     (default kept; marker preserved as historical documentation)
 *   - @adopt:composes:identity ANSWERED → simple-auth via ./auth/* (default
 *     kept; marker preserved)
 *   - References to "SI/I" → "ASI/I" in module docstring only; behavior
 *     unchanged
 */

/**
 * ASI/I — HTTP Handlers for `/grants` and `/grants/:grantId/revoke`
 *
 * // Why: Thin Hono handlers that compose `src/grants.ts` (ledger) with
 * // `src/audit.ts` (chainblocks emission). The two writes are sequenced so
 * // that audit fires FIRST, then the ledger row embeds the resulting seq as
 * // `auditBlock`. If audit fails, no ledger row is written. If ledger fails
 * // after audit succeeded, the audit stream carries an event with no matching
 * // ledger row — that's a recoverable inconsistency a sweep tool can repair,
 * // and the audit trail is what auditors trust.
 *
 * @module grants-http
 */

import type { Context } from 'hono';
import { appendGrant, appendRevoke, listGrants } from './grants.js';
// @adopt:composes:audit-ledger
// Q: Which audit-ledger archetype does this project compose?
// Default: simple-ledger via ./audit.js (chainblocks-shaped; see audit.ts).
// ANSWER:  simple-ledger (default kept).
// Reference: archetypes/simple-ledger/ARCHETYPE.md (pending)
// Notes: Replace `./audit.js` with another ledger client that returns a
//        monotonic block sequence number from each emit call. The ledger
//        row appended to `./grants.js` embeds that number as `auditBlock`
//        — the cross-reference is the load-bearing contract.
import { emitGrantEvent, emitRevokeEvent } from './audit.js';
import { ROLES, type Role } from './types.js';
// @adopt:composes:identity
// Q: Which identity archetype does this project compose?
// Default: simple-auth (verifyToken + getAuthKeyStore are bangauth-derived).
// ANSWER:  simple-auth (default kept).
// Reference: archetypes/simple-auth/ARCHETYPE.md
// Notes: Any identity replacement must export a verify function that
//        returns { valid, email, projectId, ... } and a key-store accessor
//        so the grant/revoke endpoints can authenticate the caller.
import { verifyToken } from './auth/token.js';
import { getAuthKeyStore } from './auth/server.js';

// ─── Owner gate ──────────────────────────────────────────────────────────────

/**
 * Resolve the acting user from the request's bearer token.
 *
 * // Why: As of Stage 2b the grant/revoke endpoints derive the actor from a
 * // signed token via the same path as `/resolve`, rather than trusting an
 * // `X-SI-Actor` header. The header shortcut was a Stage 2a stop-gap so the
 * // server was callable before the CLI shipped; now that the CLI carries
 * // real tokens, the shortcut is retired. Passing `X-SI-Actor` is silently
 * // ignored — we read only `Authorization: Bearer <token>`.
 *
 * Returns the resolved userId (email) on success, or a structured failure
 * the caller turns into a 401.
 */
async function actorFromToken(
  c: Context,
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const authHeader =
    c.req.header('authorization') ?? c.req.header('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, reason: 'Authentication required' };
  }
  const token = authHeader.slice('bearer '.length).trim();
  if (!token) return { ok: false, reason: 'Authentication required' };
  const verified = await verifyToken(token, getAuthKeyStore());
  if (!verified.valid) {
    return { ok: false, reason: verified.reason };
  }
  return { ok: true, userId: verified.email };
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// ─── POST /grants ────────────────────────────────────────────────────────────

interface GrantBody {
  projectId?: string;
  userId?: string;
  role?: string;
}

/**
 * Issue a new role grant.
 *
 * Body: { projectId, userId, role }
 * Header: `Authorization: Bearer <token>` (Stage 2b)
 */
export async function grantHandler(c: Context) {
  const actorResult = await actorFromToken(c);
  if (!actorResult.ok) {
    return c.json({ error: actorResult.reason }, 401);
  }
  const actor = actorResult.userId;

  let body: GrantBody;
  try {
    body = (await c.req.json()) as GrantBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const projectId = body.projectId?.trim();
  const userId = body.userId?.toLowerCase().trim();
  const role = body.role;

  if (!projectId) return c.json({ error: 'projectId is required' }, 400);
  if (!userId) return c.json({ error: 'userId is required' }, 400);
  if (!isRole(role)) {
    return c.json(
      { error: `role must be one of: ${ROLES.join(', ')}` },
      400,
    );
  }

  try {
    // Why: Audit FIRST so a failed ledger write leaves a recoverable trail.
    const auditBlock = await emitGrantEvent({
      actor,
      projectId,
      targetUserId: userId,
      role,
    });
    const grant = await appendGrant(
      { projectId, userId, role, grantedBy: actor },
      auditBlock,
    );
    return c.json(grant, 201);
  } catch (err) {
    console.error('grant error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

// ─── POST /grants/:grantId/revoke ────────────────────────────────────────────

/**
 * Revoke an existing grant by id.
 *
 * Header: `Authorization: Bearer <token>` (Stage 2b)
 */
export async function revokeHandler(c: Context) {
  const actorResult = await actorFromToken(c);
  if (!actorResult.ok) {
    return c.json({ error: actorResult.reason }, 401);
  }
  const actor = actorResult.userId;

  const grantId = c.req.param('grantId');
  if (!grantId) {
    return c.json({ error: 'grantId is required' }, 400);
  }

  try {
    // Why: We need the grant's projectId/userId/role for the audit payload;
    // fetch via the ledger before deciding whether to emit.
    const grants = await listGrants();
    const original = grants.find((g) => g.grantId === grantId && !g.revoked);
    if (!original) {
      return c.json({ error: 'Grant not found or already revoked' }, 404);
    }

    const auditBlock = await emitRevokeEvent({
      actor,
      projectId: original.projectId,
      targetUserId: original.userId,
      role: original.role,
    });
    const revoked = await appendRevoke(grantId, actor, auditBlock);
    return c.json(revoked);
  } catch (err) {
    console.error('revoke error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

// ─── GET /grants ─────────────────────────────────────────────────────────────

/**
 * List grants. Optional `?projectId=...` filter.
 *
 * // Why: Admin / debug surface. Not Owner-gated in v0.1; in v0.2 this will
 * // require an Owner token for the requested project.
 */
export async function listGrantsHandler(c: Context) {
  const projectId = c.req.query('projectId') ?? undefined;
  try {
    const grants = await listGrants(projectId);
    return c.json({ grants });
  } catch (err) {
    console.error('list-grants error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
