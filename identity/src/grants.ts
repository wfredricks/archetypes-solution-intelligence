/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/grants.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - @adopt:grants-ledger-path ANSWERED → path unchanged
 *     (<cwd>/data/identity/grants.jsonl); env-var override
 *     SI_GRANTS_PATH → ASI_GRANTS_PATH
 */

/**
 * ASI/I — Role-Grant Ledger
 *
 * Append-only JSONL ledger for ASI's 5-role permission matrix. Per
 * upstream MODEL.md §6.2.
 *
 * // Why: SI explicitly avoids a relational permission store for v0.1. The
 * // ledger is a flat JSONL file that any tool (grep, jq, even a human) can
 * // audit. Append-only means revocation writes a new row rather than mutating
 * // an existing one — the resulting tail is the complete forensic story.
 *
 * @module grants
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Role, RoleGrant } from './types.js';

// ─── Path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the grants ledger path.
 *
 * // Why: Defaults to `<cwd>/data/identity/grants.jsonl`. Overridable via
 * // `ASI_GRANTS_PATH` for tests and alt deployments.
 */
export function grantsLedgerPath(): string {
  return (
    process.env.ASI_GRANTS_PATH ??
    // @adopt:grants-ledger-path
    // Q: Where does the role-grant ledger live on disk?
    //    Dev defaults to <cwd>/data/identity/ so local runs are
    //    self-contained; production should set ASI_GRANTS_PATH to a
    //    persistent, owner-only directory backed by durable storage.
    // Default: <cwd>/data/identity/grants.jsonl
    // ANSWER:  <cwd>/data/identity/grants.jsonl  (path unchanged; env-var
    //          override renamed from SI_GRANTS_PATH → ASI_GRANTS_PATH)
    // Format: absolute filesystem path
    path.join(process.cwd(), 'data', 'identity', 'grants.jsonl')
  );
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

// ─── Grant id ────────────────────────────────────────────────────────────────

/**
 * Generate a new grant id.
 *
 * // Why: Format mirrors MODEL.md §6.2 (`g_` prefix + base32-ish suffix). We
 * // use hex from crypto.randomBytes for v0.1 — collision probability is
 * // vanishingly small for the expected grant volume.
 */
function newGrantId(): string {
  return `g_${randomBytes(10).toString('hex')}`;
}

// ─── Append helpers ──────────────────────────────────────────────────────────

async function appendLine(line: string): Promise<void> {
  const filePath = grantsLedgerPath();
  await ensureDir(filePath);
  // Why: open with 'a' and mode 0o600 so the ledger is owner-readable only
  // and writes are append-atomic at the syscall level.
  const handle = await fs.open(filePath, 'a', 0o600);
  try {
    await handle.appendFile(line.endsWith('\n') ? line : line + '\n');
  } finally {
    await handle.close();
  }
}

// ─── Read helpers ────────────────────────────────────────────────────────────

/**
 * Read every row from the ledger.
 *
 * // Why: v0.1 replays the entire file on every read. The file is small at
 * // SI's expected volume; if it ever grows past a few MB, the next refactor
 * // is an in-memory index rebuilt lazily. The public function shape stays
 * // the same so callers are insulated.
 */
async function readAllRows(): Promise<RoleGrant[]> {
  const filePath = grantsLedgerPath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const rows: RoleGrant[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      rows.push(JSON.parse(trimmed) as RoleGrant);
    }
    return rows;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Input shape for {@link appendGrant} — the caller-provided portion of a new
 * grant row.
 */
export interface NewGrantInput {
  projectId: string;
  userId: string;
  role: Role;
  grantedBy: string;
}

/**
 * Append a new grant row to the ledger.
 *
 * // Why: This is the only place new grant rows enter the ledger. The caller
 * // must have already emitted the audit event and obtained its seq, which
 * // gets embedded as `auditBlock` so the audit stream and ledger are tied
 * // together.
 */
export async function appendGrant(
  input: NewGrantInput,
  auditBlock: number,
): Promise<RoleGrant> {
  const row: RoleGrant = {
    grantId: newGrantId(),
    projectId: input.projectId,
    userId: input.userId,
    role: input.role,
    grantedBy: input.grantedBy,
    grantedAt: new Date().toISOString(),
    revoked: false,
    revokedBy: null,
    revokedAt: null,
    auditBlock,
  };
  await appendLine(JSON.stringify(row));
  return row;
}

/**
 * Append a revocation row to the ledger.
 *
 * // Why: Revocation never mutates the original grant row. Instead we write a
 * // new row carrying the same grantId, projectId, userId, and role but with
 * // `revoked: true`. Replay logic in {@link effectiveRoles} treats any
 * // grantId that has a revoked row as no longer active.
 */
export async function appendRevoke(
  grantId: string,
  revokedBy: string,
  auditBlock: number,
): Promise<RoleGrant> {
  const rows = await readAllRows();

  // Why: A grant is "already revoked" iff any later row with the same
  // grantId carries `revoked: true`. We must scan for that explicitly
  // because the original (un-revoked) row is still present in the
  // append-only ledger.
  const alreadyRevoked = rows.some((r) => r.grantId === grantId && r.revoked);
  if (alreadyRevoked) {
    throw new Error(`Grant not found or already revoked: ${grantId}`);
  }

  const original = rows.find((r) => r.grantId === grantId && !r.revoked);
  if (!original) {
    throw new Error(`Grant not found or already revoked: ${grantId}`);
  }

  const row: RoleGrant = {
    ...original,
    revoked: true,
    revokedBy,
    revokedAt: new Date().toISOString(),
    auditBlock,
  };
  await appendLine(JSON.stringify(row));
  return row;
}

/**
 * Compute the effective roles for a user within a project.
 *
 * // Why: Effective = granted AND not revoked. We scan every row and build a
 * // set of "revoked grant ids" first, then collect roles from grant rows
 * // whose grantId isn't in that set. Cheap for v0.1's expected volume.
 */
export async function effectiveRoles(
  userId: string,
  projectId: string,
): Promise<Role[]> {
  const rows = await readAllRows();
  const revokedIds = new Set<string>();
  for (const r of rows) {
    if (r.revoked) revokedIds.add(r.grantId);
  }
  const roles = new Set<Role>();
  for (const r of rows) {
    if (r.revoked) continue;
    if (r.userId !== userId) continue;
    if (r.projectId !== projectId) continue;
    if (revokedIds.has(r.grantId)) continue;
    roles.add(r.role);
  }
  return Array.from(roles);
}

/**
 * List grants for admin / debug.
 *
 * // Why: Useful from the CLI and from `GET /grants`. Filter by project when
 * // provided; return all grants otherwise. Returns raw rows including
 * // revocation rows so callers can see the full ledger story.
 */
export async function listGrants(projectId?: string): Promise<RoleGrant[]> {
  const rows = await readAllRows();
  if (!projectId) return rows;
  return rows.filter((r) => r.projectId === projectId);
}
