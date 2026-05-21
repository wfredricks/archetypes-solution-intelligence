/**
 * Derived from archetypes/solution-intel/reference-impl/identity/tests/grants.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - SI_GRANTS_PATH env-var references → ASI_GRANTS_PATH
 *   - tmpdir prefix 'si-grants-' → 'asi-grants-'
 */

/**
 * ASI/I — Grants ledger tests.
 *
 * // Why: Locks in the append-only contract per MODEL.md §6.2. Every test
 * // gets a fresh tmpdir-backed ledger so they don't interfere with each
 * // other or with whatever's on disk.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendGrant,
  appendRevoke,
  effectiveRoles,
  listGrants,
  grantsLedgerPath,
} from '../src/grants.js';

async function freshLedger(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-grants-'));
  const filePath = path.join(dir, 'grants.jsonl');
  process.env.ASI_GRANTS_PATH = filePath;
  return filePath;
}

describe('grants ledger', () => {
  beforeEach(async () => {
    await freshLedger();
  });

  it('grantsLedgerPath honors ASI_GRANTS_PATH', () => {
    expect(grantsLedgerPath()).toMatch(/grants\.jsonl$/);
  });

  it('appendGrant writes a new row with the supplied auditBlock', async () => {
    const grant = await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Owner', grantedBy: 'root@x.com' },
      0,
    );
    expect(grant.grantId).toMatch(/^g_/);
    expect(grant.revoked).toBe(false);
    expect(grant.auditBlock).toBe(0);

    const rows = await listGrants();
    expect(rows).toHaveLength(1);
    expect(rows[0].grantId).toBe(grant.grantId);
  });

  it('effectiveRoles returns the granted role', async () => {
    await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Operator', grantedBy: 'root@x.com' },
      0,
    );
    const roles = await effectiveRoles('alice@x.com', 'p1');
    expect(roles).toEqual(['Operator']);
  });

  it('effectiveRoles ignores grants for other projects/users', async () => {
    await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Operator', grantedBy: 'root@x.com' },
      0,
    );
    expect(await effectiveRoles('bob@x.com', 'p1')).toEqual([]);
    expect(await effectiveRoles('alice@x.com', 'p2')).toEqual([]);
  });

  it('appendRevoke writes a new row and effectiveRoles drops the role', async () => {
    const grant = await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Reviewer', grantedBy: 'root@x.com' },
      0,
    );
    expect(await effectiveRoles('alice@x.com', 'p1')).toEqual(['Reviewer']);

    const revoked = await appendRevoke(grant.grantId, 'root@x.com', 1);
    expect(revoked.revoked).toBe(true);
    expect(revoked.revokedBy).toBe('root@x.com');
    expect(revoked.auditBlock).toBe(1);

    const rows = await listGrants();
    expect(rows).toHaveLength(2); // append-only: 2 lines for one grant + one revoke
    expect(await effectiveRoles('alice@x.com', 'p1')).toEqual([]);
  });

  it('appendRevoke throws when the grant is unknown or already revoked', async () => {
    await expect(appendRevoke('g_missing', 'root@x.com', 0)).rejects.toThrow(
      /Grant not found/,
    );

    const grant = await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Analyst', grantedBy: 'root@x.com' },
      0,
    );
    await appendRevoke(grant.grantId, 'root@x.com', 1);
    await expect(appendRevoke(grant.grantId, 'root@x.com', 2)).rejects.toThrow(
      /Grant not found/,
    );
  });

  it('append-only invariant: grant rows are never mutated', async () => {
    const grant = await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Owner', grantedBy: 'root@x.com' },
      0,
    );
    await appendRevoke(grant.grantId, 'root@x.com', 1);

    const filePath = process.env.ASI_GRANTS_PATH!;
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    const firstRow = JSON.parse(lines[0]);
    expect(firstRow.grantId).toBe(grant.grantId);
    expect(firstRow.revoked).toBe(false); // the original row is untouched
    const secondRow = JSON.parse(lines[1]);
    expect(secondRow.grantId).toBe(grant.grantId);
    expect(secondRow.revoked).toBe(true);
  });

  it('multiple non-revoked grants accumulate distinct roles', async () => {
    await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Operator', grantedBy: 'root@x.com' },
      0,
    );
    await appendGrant(
      { projectId: 'p1', userId: 'alice@x.com', role: 'Analyst', grantedBy: 'root@x.com' },
      1,
    );
    const roles = await effectiveRoles('alice@x.com', 'p1');
    expect(roles.sort()).toEqual(['Analyst', 'Operator']);
  });

  it('listGrants supports project filter and returns all rows when omitted', async () => {
    await appendGrant(
      { projectId: 'p1', userId: 'a@x', role: 'Owner', grantedBy: 'r@x' },
      0,
    );
    await appendGrant(
      { projectId: 'p2', userId: 'b@x', role: 'Owner', grantedBy: 'r@x' },
      1,
    );
    expect(await listGrants()).toHaveLength(2);
    expect(await listGrants('p1')).toHaveLength(1);
    expect((await listGrants('p1'))[0].projectId).toBe('p1');
  });
});
