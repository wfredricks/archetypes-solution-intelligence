/**
 * Derived from archetypes/solution-intel/reference-impl/cli/tests/smoke.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - describe label '@solution-intelligence/cli scaffold' → '@asi/cli scaffold'
 *   - VERSION assertion: 0.2.0-pre → 0.1.0-pre (fresh adoption)
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  VERSION,
  loginCommand,
  grantCommand,
  revokeCommand,
  SIIdentityClient,
  loadCredentials,
  resolveUrl,
} from '../src/index.js';

describe('@asi/cli scaffold', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^0\.1\.0-pre$/);
  });

  it('exposes the command + client surface from src/index.ts', () => {
    // Why: Smoke-level guarantee that the library API survives refactors.
    // We don't call the functions here — that's what the dedicated unit
    // and integration tests are for.
    expect(typeof loginCommand).toBe('function');
    expect(typeof grantCommand).toBe('function');
    expect(typeof revokeCommand).toBe('function');
    expect(typeof loadCredentials).toBe('function');
    expect(typeof resolveUrl).toBe('function');
    expect(typeof SIIdentityClient).toBe('function');
  });

  it('cli binary prints version', () => {
    // Why: opt-in check. Only runs after `npm run build` materializes
    // dist/cli.js. CI runs `npm install && npm run build && npm test`,
    // so by the time vitest runs in CI this assertion is exercised.
    // Local `npm test` without a prior build stays green by skipping.
    if (!existsSync('dist/cli.js')) return;
    const out = execSync('node dist/cli.js --version').toString().trim();
    expect(out).toBe(VERSION);
  });

  it('cli binary --help lists login, grant, revoke', () => {
    if (!existsSync('dist/cli.js')) return;
    const out = execSync('node dist/cli.js --help').toString();
    expect(out).toMatch(/login/);
    expect(out).toMatch(/grant/);
    expect(out).toMatch(/revoke/);
  });
});
