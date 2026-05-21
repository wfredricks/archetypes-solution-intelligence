/**
 * Derived from archetypes/solution-intel/reference-impl/identity/tests/smoke.test.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - describe label: @solution-intelligence/identity → @asi/identity
 *   - VERSION assertion matches the adopter's reset 0.1.0-pre (was 0.2.0-pre)
 */

/**
 * ASI/I — Smoke test.
 *
 * // Why: Confirm VERSION re-export and that the server entry boots and
 * // shuts down cleanly. Anything beyond boot/shutdown belongs in
 * // dedicated tests.
 */

import { describe, it, expect } from 'vitest';
import { VERSION, startServer } from '../src/index.js';

describe('@asi/identity', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^0\.1\.0-pre$/);
  });

  it('startServer + close lifecycle works on port 0', async () => {
    const handle = await startServer(0);
    expect(handle.port).toBeGreaterThan(0);
    await handle.close();
  });
});
