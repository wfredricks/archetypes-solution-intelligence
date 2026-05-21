/**
 * Derived from archetypes/solution-intel/reference-impl/cli/src/commands/login.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - @adopt:composes:identity ANSWERED → simple-auth (default kept)
 *   - User-facing strings `si login:` → `asi login:`; references to
 *     SI/I URL, SI_URL, .si/config.yaml updated to ASI counterparts
 *   - Class names SIIdentityClient/SIHttpError kept (TypeScript identifier
 *     convention; the markers don't dictate class names — see
 *     ADOPTION-FINDINGS.md "class-naming" note)
 */

/**
 * `asi login` — passwordless email-and-code authentication.
 *
 * // Why: This is the entry point for everything else the CLI does. A user
 * // who isn't logged in can still inspect the binary (`--version`,
 * // `--help`), but every command that touches ASI/I requires the bearer
 * // token produced here. We cache the token under the ASI/I URL key in
 * // `~/.asi/credentials` so subsequent `asi grant` / `asi revoke` runs find
 * // it automatically.
 *
 * Exit codes:
 *   0 — success, token saved
 *   1 — auth failure (wrong/expired code, server rejected verify)
 *   2 — config/network error (no URL, connection refused, etc.)
 *
 * @module commands/login
 */

import { resolveUrl } from '../url.js';
import { setEntry } from '../credentials.js';
// @adopt:composes:identity
// Q: Which identity archetype's HTTP client does the CLI compose?
// Default: simple-auth (via SIIdentityClient — typed wrapper around the
//          identity service's /auth/request-code, /auth/verify-code, and
//          /resolve endpoints).
// ANSWER:  simple-auth (default kept). The client class name remains
//          `SIIdentityClient` to keep the identifier surface stable across
//          adoptions — it's the simple-auth contract surface, not the
//          adopter namespace.
// Reference: archetypes/simple-auth/ARCHETYPE.md
// Notes: Replacing the identity archetype means replacing this client with
//        one that exposes equivalent shapes (`requestCode`, `verifyCode`,
//        `resolve`, `grant`, `revoke`). The token shape returned by
//        verifyCode is what gets cached in ~/.asi/credentials.
import { SIIdentityClient, SIHttpError } from '../http.js';
import { promptEmail, promptCode } from '../prompts.js';

/**
 * Options for {@link loginCommand}.
 *
 * @requirement REQ-SI-NF-052
 */
export interface LoginOptions {
  /** `--url` flag value; takes precedence over env + config. */
  url?: string;
  /**
   * Pre-supplied email (e.g. from `--email`). Skips the email prompt but
   * the code round-trip still happens.
   */
  emailOverride?: string;
  /**
   * Pre-supplied code (e.g. from `--code`). Mainly for non-interactive
   * tests. Not advertised as a user-facing flag because exposing it on
   * the CLI would tempt users to bake codes into shell history.
   */
  codeOverride?: string;
  /** Defaults to process.stdin; injected by tests. */
  input?: NodeJS.ReadableStream;
  /** Defaults to process.stdout; injected by tests. */
  output?: NodeJS.WritableStream;
}

/**
 * Execute the login flow. Returns the exit code; the caller is responsible
 * for calling `process.exit()` if running under the CLI bin.
 *
 * @requirement REQ-SI-NF-052
 */
export async function loginCommand(opts: LoginOptions = {}): Promise<number> {
  const out = opts.output ?? process.stdout;
  const err = process.stderr;

  // 1) Resolve URL
  const resolution = await resolveUrl(opts.url);
  if (resolution.source === 'none') {
    err.write(
      'asi login: no ASI/I URL configured. Pass --url, set ASI_URL, or create .asi/config.yaml.\n',
    );
    return 2;
  }
  const url = resolution.url;
  const client = new SIIdentityClient(url);

  // 2) Email
  let email: string;
  if (opts.emailOverride && opts.emailOverride.trim().length > 0) {
    email = opts.emailOverride.trim().toLowerCase();
  } else {
    try {
      email = await promptEmail('Email: ', {
        input: opts.input,
        output: out,
      });
    } catch (e) {
      err.write(`asi login: ${(e as Error).message}\n`);
      return 2;
    }
  }

  // 3) Request a code
  try {
    const req = await client.requestCode(email);
    out.write(`${req.message}\n`);
  } catch (e) {
    if (e instanceof SIHttpError) {
      err.write(`asi login: request-code failed (${e.message})\n`);
      return e.status === 401 || e.status === 403 ? 1 : 2;
    }
    err.write(`asi login: ${(e as Error).message}\n`);
    return 2;
  }

  // 4) Code
  let code: string;
  if (opts.codeOverride && opts.codeOverride.trim().length > 0) {
    code = opts.codeOverride.trim();
  } else {
    try {
      code = await promptCode('Access code: ', {
        input: opts.input,
        output: out,
      });
    } catch (e) {
      err.write(`asi login: ${(e as Error).message}\n`);
      return 2;
    }
  }

  // 5) Verify
  let verify;
  try {
    verify = await client.verifyCode(email, code);
  } catch (e) {
    if (e instanceof SIHttpError) {
      err.write(`asi login: verify-code failed (${e.message})\n`);
      return 2;
    }
    err.write(`asi login: ${(e as Error).message}\n`);
    return 2;
  }

  if (!verify.authenticated || !verify.token) {
    err.write(`asi login: ${verify.error ?? 'authentication failed'}\n`);
    return 1;
  }

  // 6) Persist
  const now = new Date();
  // Why: ASI/I tokens are valid through the end of the current calendar
  // month (plus a 3-day grace). We compute "end of next month boundary"
  // as a conservative best-effort expiresAt; the server is still the
  // source of truth at verify time.
  const expiresAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 4, 0, 0, 0),
  );
  try {
    await setEntry(url, {
      token: verify.token,
      email: verify.email ?? email,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (e) {
    err.write(
      `asi login: authenticated, but failed to save credentials: ${(e as Error).message}\n`,
    );
    return 2;
  }

  out.write(`\u2713 Authenticated as ${verify.email ?? email}\n`);
  out.write(`  Credentials saved for ${url}\n`);
  return 0;
}
