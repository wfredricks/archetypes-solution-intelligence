/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/auth/__tests__/domain.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications: none (verbatim derivation)
 */

/**
 * Adapted from bangauth — https://github.com/wfredricks/bangauth
 * Source commit: 3ae510649b2450c71099ab1e43d9350bc11d7087
 * Source path: src/__tests__/domain.test.ts
 *
 * Adapted for: SI/I identity service, v0.2.0-pre (Stage 2a).
 * Maintenance ownership: SI core team. See ARCHETYPE.md for refresh policy.
 *
 * Modifications from upstream: none — copied verbatim.
 */
/**
 * Domain Allowlist Tests
 */

import { describe, it, expect } from 'vitest';
import { isDomainAllowed } from '../domain.js';

describe('Domain Allowlist', () => {
  const domains = ['credence.ai', 'test.com', 'gov.mil'];

  it('allows email from approved domain', () => {
    expect(isDomainAllowed('bill@credence.ai', domains)).toBe(true);
  });

  it('rejects email from unapproved domain', () => {
    expect(isDomainAllowed('hacker@evil.com', domains)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isDomainAllowed('bill@CREDENCE.AI', domains)).toBe(true);
  });

  it('rejects empty email', () => {
    expect(isDomainAllowed('', domains)).toBe(false);
  });

  it('rejects email without @', () => {
    expect(isDomainAllowed('notanemail', domains)).toBe(false);
  });

  it('allows .mil domain', () => {
    expect(isDomainAllowed('soldier@gov.mil', domains)).toBe(true);
  });
});
