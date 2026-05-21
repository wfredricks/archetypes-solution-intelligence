/**
 * Derived from archetypes/solution-intel/reference-impl/identity/src/audit.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - @adopt:composes:audit-ledger ANSWERED → simple-ledger (default kept)
 *   - @adopt:audit-log-path ANSWERED → default filename
 *     <cwd>/data/chainblocks/asi.audit.jsonl (was si.audit.jsonl)
 *   - @adopt:event-subject-prefix ANSWERED → `asi`
 *   - SI_AUDIT_PATH env var renamed → ASI_AUDIT_PATH
 *   - Event-type literals `si.role.granted` / `si.role.revoked` →
 *     `asi.role.granted` / `asi.role.revoked`
 */

/**
 * ASI/I — Chainblocks Audit Emission Wrapper
 *
 * // Why: ASI emits audit events for every role grant and revocation. The
 * // canonical sink is chainblocks (per upstream MODEL.md §3). v0.1 of this
 * // adoption does NOT wire real chainblocks integration; instead this
 * // wrapper writes the canonical payload to a JSONL fallback at
 * // `<cwd>/data/chainblocks/asi.audit.jsonl` and returns the per-process
 * // monotonic sequence number. A later refresh will replace the fallback
 * // with the real chainblocks client.
 *
 * // Why expose a stable interface now: every caller in ASI/I (grants-http,
 * // future revoke flow, future seal flow) calls these two functions. When
 * // the real integration lands, only this file changes.
 *
 * @module audit
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// ─── Sequence number ─────────────────────────────────────────────────────────

/**
 * Per-process monotonic audit-block sequence.
 *
 * // Why: Real chainblocks issues globally-ordered block numbers. The fallback
 * // sink approximates that with a local monotonic counter; on restart it
 * // recovers from the on-disk JSONL by counting existing lines so callers
 * // see strictly-increasing values within a workspace.
 */
let _seq = -1;

/**
 * Reset the in-memory sequence counter. Test-only helper.
 *
 * // Why: Vitest needs deterministic state across describe blocks. Production
 * // callers must never invoke this.
 */
export function _resetSeqForTests(): void {
  _seq = -1;
}

// ─── Path resolution ─────────────────────────────────────────────────────────

// @adopt:composes:audit-ledger
// Q: Which audit-ledger archetype does this project compose?
// Default: simple-ledger via chainblocks (JSONL fallback in v0.1; real
//          chainblocks integration arrives at Stage 3). The canonical sink
//          is an append-only block-chained ledger; the local fallback below
//          (one JSON line per event) is byte-compatible enough for replay.
// Reference: archetypes/simple-ledger/ARCHETYPE.md (pending)
// Notes: The functions `emitGrantEvent` / `emitRevokeEvent` are the seam.
//        Replacing them with another audit archetype (CloudWatch, OpenSearch,
//        a real chainblocks client, an OTEL pipeline) preserves the contract
//        as long as both still return a monotonic block sequence number
//        suitable for embedding as `auditBlock` on the corresponding ledger
//        row in `src/grants.ts`.
// Alternatives: any archetype whose contract satisfies the audit-ledger role.
//               Currently registered: simple-ledger (this, via chainblocks).

/**
 * Resolve the audit-log JSONL path.
 *
 * // Why: Defaults to `<cwd>/data/chainblocks/asi.audit.jsonl`; overridable
 * // via `ASI_AUDIT_PATH` for tests and alternative deployments.
 */
export function auditLogPath(): string {
  return (
    process.env.ASI_AUDIT_PATH ??
    // @adopt:audit-log-path
    // Q: Where does the audit ledger write its JSONL stream?
    //    Defaults relative to cwd so dev runs leave a local data/ tree;
    //    production deployments should override ASI_AUDIT_PATH to a
    //    persistent, owner-only directory (e.g. /var/lib/asi/chainblocks/).
    // Default: <cwd>/data/chainblocks/si.audit.jsonl
    // ANSWER:  <cwd>/data/chainblocks/asi.audit.jsonl  (filename uses the
    //          `asi` namespace; env override renamed to ASI_AUDIT_PATH)
    // Format: absolute filesystem path
    path.join(process.cwd(), 'data', 'chainblocks', 'asi.audit.jsonl')
  );
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function recoverSeqFromDisk(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.length - 1; // last seq, -1 if file empty
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return -1;
    throw err;
  }
}

async function nextSeq(): Promise<number> {
  if (_seq < 0) {
    _seq = await recoverSeqFromDisk(auditLogPath());
  }
  _seq += 1;
  return _seq;
}

// ─── Canonical payload shape ─────────────────────────────────────────────────

// @adopt:event-subject-prefix
// Q: What prefix do this project's audit-event types use?
//    Embedded in the `type` field of every emitted audit event; used by
//    downstream consumers (Scribe, NATS subscribers, OTEL pipelines) to
//    filter on subject patterns. Keep aligned with @adopt:project-id.
// Default: si  (events: "si.role.granted", "si.role.revoked")
// ANSWER:  asi (events: "asi.role.granted", "asi.role.revoked")
// Format: [a-z][a-z0-9-]{1,15}
export interface AuditEventBase {
  /** Block sequence (monotonic, per-process for v0.1). */
  seq: number;
  /** ISO-8601 UTC emission timestamp. */
  ts: string;
  /** Event type per upstream MODEL.md §3.2 (renamed for asi namespace). */
  type: 'asi.role.granted' | 'asi.role.revoked';
  /** Who triggered the event (userId of the Owner). */
  actor: string;
  /** Project scope of the event. */
  projectId: string;
  /** Target subject of the event. */
  targetUserId: string;
  /** Role affected by the event. */
  role: string;
}

interface EmitPayload {
  actor: string;
  projectId: string;
  targetUserId: string;
  role: string;
}

async function emit(type: AuditEventBase['type'], payload: EmitPayload): Promise<number> {
  const filePath = auditLogPath();
  await ensureDir(filePath);
  const seq = await nextSeq();
  const event: AuditEventBase = {
    seq,
    ts: new Date().toISOString(),
    type,
    actor: payload.actor,
    projectId: payload.projectId,
    targetUserId: payload.targetUserId,
    role: payload.role,
  };
  // Why: append-mode write + JSONL line so the file remains a valid audit
  // stream readable by any line-oriented tool.
  await fs.appendFile(filePath, JSON.stringify(event) + '\n', { mode: 0o600 });
  return seq;
}

/**
 * Emit an `asi.role.granted` audit event and return its seq.
 *
 * // Why: Called from `src/grants-http.ts` immediately before persisting the
 * // grant row. Caller embeds the returned seq in the RoleGrant as `auditBlock`
 * // so the ledger and audit stream stay cross-referenced.
 */
export async function emitGrantEvent(payload: EmitPayload): Promise<number> {
  return emit('asi.role.granted', payload);
}

/**
 * Emit an `asi.role.revoked` audit event and return its seq.
 */
export async function emitRevokeEvent(payload: EmitPayload): Promise<number> {
  return emit('asi.role.revoked', payload);
}
