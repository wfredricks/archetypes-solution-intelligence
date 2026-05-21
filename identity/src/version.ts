/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/version.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - VERSION reset to 0.1.0-pre (this is a fresh adoption, not the
 *     upstream's continued versioning)
 */

/**
 * Package version.
 *
 * // Why: Re-exported from `src/index.ts` so importers have a stable single
 * // symbol to assert against (smoke test, /health endpoint, audit payloads).
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.1.0-pre';
