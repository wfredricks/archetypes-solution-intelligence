/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/types.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - none (pure type definitions; no adoption-time choices)
 */

/**
 * SI/I — Public Types
 *
 * // Why: These are the SI-public type definitions used by the role-grant
 * // ledger, /resolve endpoint, and downstream services (SI/S, SI/W). They are
 * // intentionally separate from `src/auth/types.ts` (the bangauth archetype's
 * // internal types) so the archetype boundary stays clean.
 *
 * Schemas follow MODEL.md §6.2 exactly.
 *
 * @module types
 */

/**
 * SI's 5-role permission matrix.
 *
 * // Why: Per MODEL.md §6.1 / REQ-SI-NF-031. Owner is the only role that can
 * // grant or revoke grants. Operator runs solutions. Analyst inspects.
 * // Reviewer signs off. Customer reads results. A user may hold multiple
 * // roles for the same project simultaneously.
 */
export type Role = 'Owner' | 'Operator' | 'Analyst' | 'Reviewer' | 'Customer';

/**
 * The full set of role values, useful for runtime validation.
 */
export const ROLES: readonly Role[] = ['Owner', 'Operator', 'Analyst', 'Reviewer', 'Customer'];

/**
 * One row in the role-grant ledger.
 *
 * // Why: Per MODEL.md §6.2. The ledger is append-only JSONL — every state
 * // change is a new row. Revocation does NOT mutate the original grant row;
 * // it writes a new row with `revoked: true` referencing the same grantId.
 */
export interface RoleGrant {
  /** Unique id for the grant, e.g. `g_01HX...`. */
  grantId: string;
  /** Project this grant scopes to. */
  projectId: string;
  /** Subject of the grant (the user receiving the role). */
  userId: string;
  /** Role granted. */
  role: Role;
  /** User id of the Owner who issued the grant. */
  grantedBy: string;
  /** ISO-8601 UTC timestamp of when the grant was issued. */
  grantedAt: string;
  /** Whether this row represents a revocation. */
  revoked: boolean;
  /** User id of the Owner who issued the revocation (null on grant rows). */
  revokedBy: string | null;
  /** ISO-8601 UTC timestamp of the revocation (null on grant rows). */
  revokedAt: string | null;
  /**
   * Chainblocks audit-event sequence number for this row.
   *
   * // Why: Ties the ledger row to the audit emission so a forensic trace can
   * // hop from grant → audit block in one step.
   */
  auditBlock: number;
}

/**
 * Response payload for `POST /resolve`.
 *
 * // Why: SI/S and SI/W call /resolve with a bearer token. The response tells
 * // them who the caller is and what they're allowed to do, per MODEL.md §6.3.
 */
export interface ResolveResponse {
  /** User id (the canonical, lowercased email). */
  userId: string;
  /** Display name (for v0.1 we echo the userId; richer names land in v0.2). */
  displayName: string;
  /** Effective non-revoked roles for the user in the resolved project. */
  effectiveRoles: Role[];
}
