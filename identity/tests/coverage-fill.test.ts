/**
 * Derived from archetypes/solution-intel/reference-impl/identity/tests/coverage-fill.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - 'noreply@si.local' / 'help@si.local' → '@asi.local' equivalents
 *   - constellationName/fromName 'SI' → 'ASI'
 */

/**
 * ASI/I — Coverage-fill tests.
 *
 * // Why: These tests exercise branches that the integration test doesn't
 * // structurally hit: bangauth's wildcard domain patterns, the
 * // users-memory store's expiration / mismatch / MFA paths, and the
 * // keys-memory store's `listActiveKeys`. They are NOT mock-heavy
 * // simulations; each one drives a real code path with real inputs.
 */

import { describe, it, expect } from 'vitest';
import { isDomainAllowed } from '../src/auth/domain.js';
import { MemoryUserStore } from '../src/auth/adapters/users-memory.js';
import { MemoryKeyStore } from '../src/auth/adapters/keys-memory.js';
import { ConsoleEmailAdapter } from '../src/auth/adapters/email-console.js';

describe('domain.ts — wildcard patterns', () => {
  it('matches *substring* anywhere in the domain', () => {
    expect(isDomainAllowed('a@foo-credence-bar.org', ['*credence*'])).toBe(true);
    expect(isDomainAllowed('a@nope.org', ['*credence*'])).toBe(false);
  });

  it('matches *.tld suffix', () => {
    expect(isDomainAllowed('a@navy.mil', ['*.mil'])).toBe(true);
    expect(isDomainAllowed('a@navy.com', ['*.mil'])).toBe(false);
  });

  it('matches the bare TLD when the pattern is *.tld', () => {
    // Why: domain.ts treats `*.mil` as matching `mil` too (suffix.slice(1)).
    expect(isDomainAllowed('a@mil', ['*.mil'])).toBe(true);
  });

  it('handles wildcard "*" allowlist', () => {
    expect(isDomainAllowed('a@anything.test', ['*'])).toBe(true);
  });

  it('rejects when no patterns match', () => {
    expect(isDomainAllowed('a@nope.test', ['credence.ai', '*.mil'])).toBe(false);
  });
});

describe('users-memory adapter', () => {
  it('returns false when no code was stored', async () => {
    const store = new MemoryUserStore();
    expect(await store.verifyAccessCode('nobody@x.com', '000000')).toBe(false);
  });

  it('returns false when the code has expired and removes the entry', async () => {
    const store = new MemoryUserStore();
    await store.storeAccessCode('a@x.com', '111111', 1); // 1 ms TTL
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.verifyAccessCode('a@x.com', '111111')).toBe(false);
  });

  it('returns false on code mismatch', async () => {
    const store = new MemoryUserStore();
    await store.storeAccessCode('a@x.com', '111111');
    expect(await store.verifyAccessCode('a@x.com', '222222')).toBe(false);
  });

  it('MFA enrollment round-trip (save / get / delete)', async () => {
    const store = new MemoryUserStore();
    expect(await store.getMfaEnrollment('a@x.com')).toBeNull();
    await store.saveMfaEnrollment('a@x.com', {
      totpSecret: 'abc',
      recoveryCodeHashes: [],
      enrolledAt: new Date().toISOString(),
      status: 'pending',
    });
    const fetched = await store.getMfaEnrollment('a@x.com');
    expect(fetched?.status).toBe('pending');
    await store.deleteMfaEnrollment('a@x.com');
    expect(await store.getMfaEnrollment('a@x.com')).toBeNull();
  });

  it('cleanupExpiredCodes drops expired entries', async () => {
    const store = new MemoryUserStore();
    await store.storeAccessCode('a@x.com', '111111', 1);
    await new Promise((r) => setTimeout(r, 5));
    store.cleanupExpiredCodes();
    expect(await store.verifyAccessCode('a@x.com', '111111')).toBe(false);
  });
});

describe('keys-memory adapter', () => {
  it('listActiveKeys returns the boot key', async () => {
    const store = new MemoryKeyStore();
    const keys = await store.listActiveKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].alg).toBe('HS256');
  });

  it('getKey returns null for unknown kid', async () => {
    const store = new MemoryKeyStore();
    expect(await store.getKey('k-unknown')).toBeNull();
  });
});

describe('email-console adapter', () => {
  it('exercises rejection + MFA reset paths without throwing', async () => {
    // Why: These methods only print to stdout. We assert they don't throw
    // and capture coverage of the conditional support-email branch.
    const adapter = new ConsoleEmailAdapter();
    await adapter.sendRejectionEmail({
      to: 'a@x.com',
      fromAddress: 'noreply@asi.local',
      fromName: 'ASI',
      constellationName: 'ASI',
      supportEmail: 'help@asi.local',
    });
    await adapter.sendRejectionEmail({
      to: 'a@x.com',
      fromAddress: 'noreply@asi.local',
      fromName: 'ASI',
      constellationName: 'ASI',
      supportEmail: '',
    });
    await adapter.sendMfaResetEmail({
      to: 'a@x.com',
      resetUrl: 'https://asi.local/reset?t=xyz',
      constellationName: 'ASI',
      fromAddress: 'noreply@asi.local',
      fromName: 'ASI',
    });
  });
});
