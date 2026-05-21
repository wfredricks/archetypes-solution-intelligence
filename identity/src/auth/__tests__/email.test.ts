/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/auth/__tests__/email.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications: none (verbatim derivation)
 */

/**
 * Adapted from bangauth — https://github.com/wfredricks/bangauth
 * Source commit: 3ae510649b2450c71099ab1e43d9350bc11d7087
 * Source path: src/__tests__/email.test.ts
 *
 * Adapted for: SI/I identity service, v0.2.0-pre (Stage 2a).
 * Maintenance ownership: SI core team. See ARCHETYPE.md for refresh policy.
 *
 * Modifications from upstream: none — copied verbatim.
 */
/**
 * Email Builder Tests — test the pure template functions
 * without importing the AWS SES client.
 */

import { describe, it, expect } from 'vitest';

// Note: We can't import email.ts directly because it imports @aws-sdk/client-sesv2.
// This is exactly the adapter boundary — the email TEMPLATE logic should be
// extracted from the SES SENDING logic. For now, test the concept.

describe('Email Template (concept)', () => {
  it('email should contain the token', () => {
    // When we extract the adapter, buildTokenEmail will be pure
    const token = 'abc123def456';
    const loginUrl = 'https://myapp.com/login';
    const link = `${loginUrl}?token=${token}`;

    expect(link).toContain(token);
    expect(link).toContain('https://myapp.com/login');
  });

  it('email should contain the app name', () => {
    const fromName = 'BangAuth';
    const subject = `Your ${fromName} access code`;
    expect(subject).toContain('BangAuth');
  });

  it('link format is correct', () => {
    const token = 'test-token';
    const loginUrl = 'https://myapp.com/auth/verify';
    const link = `${loginUrl}?token=${encodeURIComponent(token)}`;
    expect(link).toBe('https://myapp.com/auth/verify?token=test-token');
  });
});
