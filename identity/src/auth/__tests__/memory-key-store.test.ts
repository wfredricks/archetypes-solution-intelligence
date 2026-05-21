/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/auth/__tests__/memory-key-store.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications: none (verbatim derivation)
 */

/**
 * Adapted from bangauth — https://github.com/wfredricks/bangauth
 * Source commit: 3ae510649b2450c71099ab1e43d9350bc11d7087
 * Source path: src/__tests__/memory-key-store.test.ts
 *
 * Adapted for: SI/I identity service, v0.2.0-pre (Stage 2a).
 * Maintenance ownership: SI core team. See ARCHETYPE.md for refresh policy.
 *
 * Modifications from upstream: none — copied verbatim.
 */
/**
 * MemoryKeyStore adapter tests.
 *
 * Why: The adapter logic (getCurrentKey, listActiveKeys, addKey, setCurrentKid,
 * createMemoryKeyStore factory) was at 33% coverage — dragging BangAuth below
 * the 85% threshold. These tests cover the adapter API exhaustively without
 * touching any AWS dependency.
 *
 * Added by: coverage patrol (2026-05-13)
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryKeyStore,
  createTestKey,
  createMemoryKeyStore,
} from '../adapters/memory-key-store.js';

describe('MemoryKeyStore adapter', () => {
  describe('createTestKey', () => {
    it('returns a SigningKey with default kid prefix', () => {
      const key = createTestKey();
      expect(key.kid).toMatch(/^k-test-/);
      expect(key.alg).toBe('HS256');
      expect(key.secret).toHaveLength(64); // 32 bytes hex
      expect(key.active).toBe(true);
      expect(new Date(key.createdAt).toString()).not.toBe('Invalid Date');
      expect(new Date(key.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('honors a provided kid', () => {
      const key = createTestKey('custom-kid');
      expect(key.kid).toBe('custom-kid');
    });

    it('generates unique secrets across invocations', () => {
      const a = createTestKey();
      const b = createTestKey();
      expect(a.secret).not.toBe(b.secret);
    });
  });

  describe('constructor + getKey', () => {
    it('seeds with the provided initial key', async () => {
      const seed = createTestKey('seeded');
      const store = new MemoryKeyStore(seed);
      const fetched = await store.getKey('seeded');
      expect(fetched).toEqual(seed);
    });

    it('creates a default key when none provided', async () => {
      const store = new MemoryKeyStore();
      const fetched = await store.getKey('k-test');
      expect(fetched).not.toBeNull();
      expect(fetched?.kid).toBe('k-test');
    });

    it('returns null for unknown kid', async () => {
      const store = new MemoryKeyStore();
      const fetched = await store.getKey('nope');
      expect(fetched).toBeNull();
    });
  });

  describe('getCurrentKey', () => {
    it('returns the active current key', async () => {
      const seed = createTestKey('cur');
      const store = new MemoryKeyStore(seed);
      const cur = await store.getCurrentKey();
      expect(cur.kid).toBe('cur');
    });

    it('throws when current key is missing', async () => {
      const store = new MemoryKeyStore();
      store.setCurrentKid('does-not-exist');
      await expect(store.getCurrentKey()).rejects.toThrow(
        /Current key not found: does-not-exist/,
      );
    });
  });

  describe('listActiveKeys', () => {
    it('lists only active keys with summary fields', async () => {
      const active = createTestKey('a');
      const store = new MemoryKeyStore(active);
      const inactive = createTestKey('b');
      inactive.active = false;
      store.addKey(inactive);

      const list = await store.listActiveKeys();
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({
        kid: 'a',
        alg: 'HS256',
        expiresAt: active.expiresAt,
      });
    });

    it('returns an empty list when nothing is active', async () => {
      const seed = createTestKey('only');
      seed.active = false;
      const store = new MemoryKeyStore(seed);
      const list = await store.listActiveKeys();
      expect(list).toEqual([]);
    });
  });

  describe('addKey + setCurrentKid', () => {
    it('rotates the current key', async () => {
      const store = new MemoryKeyStore(createTestKey('k1'));
      const k2 = createTestKey('k2');
      store.addKey(k2);
      store.setCurrentKid('k2');
      const cur = await store.getCurrentKey();
      expect(cur.kid).toBe('k2');
    });

    it('addKey overwrites an existing kid', async () => {
      const store = new MemoryKeyStore(createTestKey('same'));
      const replacement = createTestKey('same');
      store.addKey(replacement);
      const fetched = await store.getKey('same');
      expect(fetched?.secret).toBe(replacement.secret);
    });
  });

  describe('createMemoryKeyStore factory', () => {
    it('returns a wired store + key pair', async () => {
      const { store, key } = createMemoryKeyStore();
      expect(key.kid).toBe('k-test');
      const cur = await store.getCurrentKey();
      expect(cur).toEqual(key);
      const list = await store.listActiveKeys();
      expect(list).toHaveLength(1);
      expect(list[0].kid).toBe('k-test');
    });
  });
});
