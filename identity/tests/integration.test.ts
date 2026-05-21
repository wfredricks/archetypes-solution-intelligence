/**
 * Derived from archetypes/solution-intel/reference-impl/identity/tests/integration.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - All SI_* env-var references → ASI_*
 *   - tmpdir prefix 'si-int-' → 'asi-int-'
 *   - /health service-name assertion: 'si-identity' → 'asi-identity'
 */

/**
 * ASI/I — End-to-end integration test.
 *
 * // Why: Boots the full server on an ephemeral port and walks the canonical
 * // flow: request-code → verify-code → grant → resolve → revoke → resolve.
 * // This is the load-bearing test that proves the bangauth archetype, the
 * // grants ledger, the audit emission, and the Hono composition all work
 * // together as one service.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer, type ServerHandle } from '../src/server.js';
import { _resetSeqForTests } from '../src/audit.js';
import { _resetAuthSingletonsForTests } from '../src/auth/server.js';

let handle: ServerHandle;
let baseUrl: string;

beforeAll(async () => {
  // Why: Fresh paths so the integration test doesn't trample local state.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-int-'));
  process.env.ASI_GRANTS_PATH = path.join(dir, 'grants.jsonl');
  process.env.ASI_AUDIT_PATH = path.join(dir, 'audit.jsonl');
  process.env.ASI_DEV_CODE = '123456';
  process.env.ASI_ALLOWED_DOMAINS = '*';
  process.env.ASI_PROJECT_ID = 'p-integration';
  _resetSeqForTests();
  // Why: Reset lazy singletons so the env-var changes above are read fresh
  // when the server boots.
  _resetAuthSingletonsForTests();
  handle = await startServer(0);
  baseUrl = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(() => {
  _resetSeqForTests();
});

async function jpost(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function jget(url: string) {
  const res = await fetch(`${baseUrl}${url}`);
  const data = await res.json();
  return { status: res.status, data };
}

describe('SI/I integration', () => {
  it('GET /health returns 200 and reports the service', async () => {
    const { status, data } = await jget('/health');
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).ok).toBe(true);
    expect((data as Record<string, unknown>).service).toBe('asi-identity');
  });

  it('walks the full request-code → verify-code → grant → resolve → revoke flow', async () => {
    // Why: Stage 2b retired the `X-SI-Actor` header. The actor now comes from
    // a bearer token, just like `/resolve`. We log in BOTH alice (target of
    // a grant) and root (the actor doing the granting) so the test exercises
    // the production path end-to-end.

    // 1a) Request a code for alice
    const aliceReq = await jpost('/auth/request-code', { email: 'alice@x.com' });
    expect(aliceReq.status).toBe(200);

    // 1b) Verify alice's code
    const aliceVerify = await jpost('/auth/verify-code', {
      email: 'alice@x.com',
      code: '123456',
    });
    expect(aliceVerify.status).toBe(200);
    const aliceBody = aliceVerify.data as { authenticated: boolean; email: string; token: string };
    expect(aliceBody.authenticated).toBe(true);
    const aliceToken = aliceBody.token;

    // 1c) Same flow for root
    await jpost('/auth/request-code', { email: 'root@x.com' });
    const rootVerify = await jpost('/auth/verify-code', {
      email: 'root@x.com',
      code: '123456',
    });
    expect(rootVerify.status).toBe(200);
    const rootToken = (rootVerify.data as { token: string }).token;

    // 2) Root grants alice the Operator role, authenticating via bearer token
    const grant = await jpost(
      '/grants',
      { projectId: 'p-integration', userId: 'alice@x.com', role: 'Operator' },
      { authorization: `Bearer ${rootToken}` },
    );
    expect(grant.status).toBe(201);
    const grantBody = grant.data as { grantId: string; role: string; grantedBy: string };
    expect(grantBody.role).toBe('Operator');
    expect(grantBody.grantedBy).toBe('root@x.com');

    // 3) Resolve alice's token — should report Operator
    const resolve1 = await jpost('/resolve', { token: aliceToken });
    expect(resolve1.status).toBe(200);
    const resolveBody1 = resolve1.data as { userId: string; effectiveRoles: string[] };
    expect(resolveBody1.userId).toBe('alice@x.com');
    expect(resolveBody1.effectiveRoles).toContain('Operator');

    // 4) Root revokes the grant, again authenticating via bearer token
    const revoke = await jpost(
      `/grants/${grantBody.grantId}/revoke`,
      {},
      { authorization: `Bearer ${rootToken}` },
    );
    expect(revoke.status).toBe(200);
    const revokeBody = revoke.data as { revoked: boolean };
    expect(revokeBody.revoked).toBe(true);

    // 5) Resolve alice's token again — Operator is gone
    const resolve2 = await jpost('/resolve', { token: aliceToken });
    expect(resolve2.status).toBe(200);
    const resolveBody2 = resolve2.data as { effectiveRoles: string[] };
    expect(resolveBody2.effectiveRoles).not.toContain('Operator');
  });

  it('rejects /grants without a bearer token', async () => {
    const res = await jpost('/grants', {
      projectId: 'p-integration',
      userId: 'eve@x.com',
      role: 'Owner',
    });
    expect(res.status).toBe(401);
  });

  it('rejects /grants with an invalid bearer token', async () => {
    const res = await jpost(
      '/grants',
      { projectId: 'p-integration', userId: 'eve@x.com', role: 'Owner' },
      { authorization: 'Bearer not-a-real-token' },
    );
    expect(res.status).toBe(401);
  });

  it('ignores X-SI-Actor and still requires a bearer token', async () => {
    // Why: Regression test for the Stage 2b retirement — a client still
    // sending the old header gets a 401, not silent acceptance.
    const res = await jpost(
      '/grants',
      { projectId: 'p-integration', userId: 'eve@x.com', role: 'Owner' },
      { 'x-si-actor': 'root@x.com' },
    );
    expect(res.status).toBe(401);
  });

  it('rejects /grants with an invalid role', async () => {
    // Mint a real token first so we get past the bearer gate.
    await jpost('/auth/request-code', { email: 'root@x.com' });
    const rootVerify = await jpost('/auth/verify-code', {
      email: 'root@x.com',
      code: '123456',
    });
    const rootToken = (rootVerify.data as { token: string }).token;
    const res = await jpost(
      '/grants',
      { projectId: 'p-integration', userId: 'eve@x.com', role: 'Wizard' },
      { authorization: `Bearer ${rootToken}` },
    );
    expect(res.status).toBe(400);
  });

  it('rejects /resolve with a bad bearer token via Authorization header', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });
});
