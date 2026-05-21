/**
 * Derived from archetypes/solution-intel/reference-impl/identity/tests/resolve.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - SI_* env-var references → ASI_*
 *   - tmpdir prefix 'si-resolve-' → 'asi-resolve-'
 */

/**
 * ASI/I — Resolve tests.
 *
 * // Why: Exercises the pure {@link resolveToken} path. The HTTP wrapping is
 * // covered by `integration.test.ts`. Each test gets fresh ledger + audit
 * // paths to isolate state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveToken } from '../src/resolve.js';
import { getAuthKeyStore, getAuthConfig, _resetAuthSingletonsForTests } from '../src/auth/server.js';
import { generateToken, currentMonth } from '../src/auth/token.js';
import { appendGrant } from '../src/grants.js';
import { _resetSeqForTests } from '../src/audit.js';

async function freshState(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-resolve-'));
  process.env.ASI_GRANTS_PATH = path.join(dir, 'grants.jsonl');
  process.env.ASI_AUDIT_PATH = path.join(dir, 'audit.jsonl');
  _resetSeqForTests();
  // Why: Fresh auth singletons so the key store rotates between tests; this
  // prevents a stale token from a previous run from accidentally verifying.
  _resetAuthSingletonsForTests();
}

describe('resolveToken', () => {
  beforeEach(async () => {
    await freshState();
  });

  it('returns 401 on bad token', async () => {
    const outcome = await resolveToken('not-a-real-token');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(401);
  });

  it('returns 400 on empty token', async () => {
    const outcome = await resolveToken('');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.status).toBe(400);
  });

  it('returns a ResolveResponse with effectiveRoles for a valid token', async () => {
    const cfg = getAuthConfig();
    const key = await getAuthKeyStore().getCurrentKey();
    const token = generateToken('alice@x.com', currentMonth(), key, cfg.projectId);

    await appendGrant(
      { projectId: cfg.projectId, userId: 'alice@x.com', role: 'Operator', grantedBy: 'root@x.com' },
      0,
    );

    const outcome = await resolveToken(token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.response.userId).toBe('alice@x.com');
    expect(outcome.response.displayName).toBe('alice@x.com');
    expect(outcome.response.effectiveRoles).toEqual(['Operator']);
  });

  it('returns empty effectiveRoles when no grants exist', async () => {
    const cfg = getAuthConfig();
    const key = await getAuthKeyStore().getCurrentKey();
    const token = generateToken('bob@x.com', currentMonth(), key, cfg.projectId);

    const outcome = await resolveToken(token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.response.effectiveRoles).toEqual([]);
  });
});
