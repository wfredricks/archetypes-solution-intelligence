/**
 * Derived from archetypes/solution-intel/reference-impl/cli/src/index.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - Header reference `@solution-intelligence/cli` → `@asi/cli`
 */

/**
 * Public library exports for `@asi/cli`.
 *
 * // Why: The package primarily ships a bin (`si`), but the underlying
 * // modules are exported for downstream tooling — most notably integration
 * // tests that drive the commands programmatically rather than via the
 * // shell. We re-export only what's stable; internal helpers stay private.
 *
 * @module index
 */

export { VERSION } from './version.js';
export {
  loadCredentials,
  saveCredentials,
  getEntry,
  setEntry,
  clearEntry,
  normalizeUrl,
  credentialsDir,
  credentialsPath,
  type Credentials,
  type CredentialEntry,
} from './credentials.js';
export {
  resolveUrl,
  resolveProjectConfig,
  findProjectConfig,
  type UrlResolution,
  type ProjectConfig,
  type ProjectConfigResolution,
} from './url.js';
export {
  SIIdentityClient,
  SIHttpError,
  type GrantResponse,
  type RevokeResponse,
  type LoginRequestResponse,
  type LoginVerifyResponse,
  type ResolveResponse,
  type HealthResponse,
} from './http.js';
export { promptText, promptEmail, promptCode, type PromptOptions } from './prompts.js';
export { loginCommand, type LoginOptions } from './commands/login.js';
export { grantCommand, type GrantOptions } from './commands/grant.js';
export { revokeCommand, type RevokeOptions } from './commands/revoke.js';
