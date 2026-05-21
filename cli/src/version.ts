/**
 * Derived from archetypes/solution-intel/reference-impl/cli/src/version.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - VERSION reset to 0.1.0-pre (fresh adoption)
 */

/**
 * Package version. Single source of truth for `asi --version` and library
 * consumers.
 *
 * // Why: Hoisted out of `src/index.ts` in Stage 2b so the CLI bin
 * // (`src/cli.ts`) can import the version without pulling in the rest of
 * // the library surface (credentials, http client, prompts). Keeps the
 * // bin's startup footprint minimal.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.1.0-pre';
