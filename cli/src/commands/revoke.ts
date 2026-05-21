/**
 * Derived from archetypes/solution-intel/reference-impl/cli/src/commands/revoke.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - User-facing strings `si revoke:` → `asi revoke:`; SI_URL / .si/config.yaml
 *     references → ASI_URL / .asi/config.yaml
 */

/**
 * `asi revoke <project> <grantId>` — Owner-gated revocation.
 *
 * // Why: Symmetric counterpart to `asi grant`. We pass `projectId` in the
 * // body even though ASI/I derives projectId from the stored grant — this
 * // gives the server a chance to cross-check the URL grantId against the
 * // asserted project and reject mismatches (defense against copy-pasting
 * // the wrong grant id).
 *
 * Exit codes:
 *   0 — revoked
 *   1 — authz failure
 *   2 — config/network/usage error
 *
 * @module commands/revoke
 */

import { resolveUrl } from '../url.js';
import { getEntry } from '../credentials.js';
import { SIIdentityClient, SIHttpError } from '../http.js';

/**
 * Options for {@link revokeCommand}.
 *
 * @requirement REQ-SI-NF-052
 */
export interface RevokeOptions {
  url?: string;
  project: string;
  grantId: string;
}

/**
 * Execute the revoke flow. Returns the exit code.
 *
 * @requirement REQ-SI-NF-052
 */
export async function revokeCommand(opts: RevokeOptions): Promise<number> {
  const out = process.stdout;
  const err = process.stderr;

  // 1) URL
  const resolution = await resolveUrl(opts.url);
  if (resolution.source === 'none') {
    err.write(
      'asi revoke: no ASI/I URL configured. Pass --url, set ASI_URL, or create .asi/config.yaml.\n',
    );
    return 2;
  }
  const url = resolution.url;

  // 2) Credentials
  const entry = await getEntry(url);
  if (!entry) {
    err.write(
      `asi revoke: not logged in for ${url}. Run: asi login --url ${url}\n`,
    );
    return 1;
  }

  // 3) Call
  const client = new SIIdentityClient(url, entry.token);
  try {
    const result = await client.revoke(opts.project, opts.grantId);
    const auditSegment =
      typeof result.auditBlock === 'number'
        ? ` (audit seq: ${result.auditBlock})`
        : '';
    out.write(
      `\u2713 Revoked grant ${result.grantId}${auditSegment}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof SIHttpError) {
      err.write(`asi revoke: ${e.message}\n`);
      if (e.status === 401 || e.status === 403) return 1;
      return 2;
    }
    err.write(`asi revoke: ${(e as Error).message}\n`);
    return 2;
  }
}
