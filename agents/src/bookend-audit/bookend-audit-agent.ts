/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §C.
 *
 *   Ownership: asi-local. solution-intel archetype's first agent
 *   surface; this package becomes ./reference-impl/agents/ in the
 *   archetype's next snapshot lift.
 *
 * @module bookend-audit/bookend-audit-agent
 */

/**
 * `BookendAuditAgent` — for a given archetype, regenerate the
 * right-bookend snapshot from current SIG state, diff against the
 * committed file in `wfredricks/archetypes`, emit findings about drift.
 *
 * // Why: bookend snapshot files are downstream evidence; the SIG is
 * // upstream truth. Operators need a way to detect when the two have
 * // drifted apart (e.g. a writeback script ran but the snapshot file
 * // wasn't regenerated). This agent is read-only on both sides — it
 * // does NOT commit a refreshed snapshot.
 *
 * // Idempotency: read-only. Re-running on an unchanged SIG and
 * // unchanged committed snapshot produces an identical report
 * // (modulo `ranAt`).
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { Driver, Session } from 'neo4j-driver';
import neo4j from 'neo4j-driver';

import type { AgentReport, AgentRunOptions, Finding } from '../types.js';
import { summarize } from '../types.js';
import { normalizeIsoString } from '../completeness/completeness-agent.js';
import { parseSnapshot, type ParsedSnapshotRow } from './parse-snapshot.js';

export const AGENT_NAME = 'BookendAuditAgent';
export const AGENT_VERSION = '0.1.0-pre';
const DEFAULT_NAMESPACE = 'asi';
const DEFAULT_GRAPH_URL = 'bolt://localhost:7689';
const DEFAULT_GRAPH_USER = 'neo4j';
const DEFAULT_GRAPH_PASS = 'udt-pass-2026';

/** Options for `runBookendAuditAgent`. */
export interface BookendAuditOptions extends AgentRunOptions {
  /** Archetype name to audit (e.g. `events-spine`). */
  archetypeName: string;
  /** Filesystem path to a `wfredricks/archetypes` checkout. */
  archetypesRepoPath: string;
  /** Optional pre-built driver (caller-owns-driver semantics). */
  driver?: Driver;
  /** Optional clock override for tests. */
  now?: () => Date;
}

/** Hypothesis row pulled from the SIG. */
interface SigHypothesisRow {
  key: string;
  text: string;
  status: string;
  verifiedAt: string | null;
}

/**
 * Run the BookendAuditAgent and return its report.
 *
 * Behavior:
 *   1. Read all hypotheses for `archetypeName` from the SIG.
 *   2. Find the most recent `RIGHT-BOOKEND-snapshot-*.md` for the
 *      archetype in the `archetypes` checkout.
 *   3. Parse the committed snapshot's table into structured rows.
 *   4. Diff and emit findings.
 *
 * Connection: when `opts.driver` is supplied it is used and not
 * closed. Otherwise a driver is built from `graphUrl/graphUser/
 * graphPass` and closed before returning.
 */
export async function runBookendAuditAgent(opts: BookendAuditOptions): Promise<AgentReport> {
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const nowFn = opts.now ?? (() => new Date());
  const ranAt = nowFn().toISOString();
  const archetypeName = opts.archetypeName;

  const ownsDriver = opts.driver === undefined;
  const driver: Driver = opts.driver ?? makeDriver(opts);
  const findings: Finding[] = [];
  let sigRows: SigHypothesisRow[] = [];
  try {
    const session = driver.session();
    try {
      sigRows = await fetchSigHypotheses(session, namespace, archetypeName);
    } finally {
      await session.close();
    }
  } finally {
    if (ownsDriver) await driver.close();
  }

  const archetypeDir = path.join(opts.archetypesRepoPath, archetypeName);
  const snapshotPath = await findLatestSnapshot(archetypeDir);
  if (!snapshotPath) {
    findings.push({
      agentName: AGENT_NAME,
      ruleId: 'bookend-audit:missing-snapshot',
      severity: 'error',
      archetype: archetypeName,
      message: `No RIGHT-BOOKEND-snapshot-*.md found in ${archetypeDir}.`,
      details: { sigHypothesisCount: sigRows.length },
    });
    return {
      agentName: AGENT_NAME,
      agentVersion: AGENT_VERSION,
      namespace,
      ranAt,
      findings,
      summary: summarize(findings),
    };
  }

  const committedBody = await readFile(snapshotPath, 'utf8');
  const committedRows = parseSnapshot(committedBody);
  diffRows(findings, archetypeName, sigRows, committedRows, snapshotPath);

  return {
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    namespace,
    ranAt,
    findings,
    summary: summarize(findings),
  };
}

/**
 * Pull all hypotheses for `archetypeName` in the namespace, ordered by key.
 *
 * // Why: this mirrors the query in
 * // `scripts/snapshot-events-spine.ts` so a SIG-to-snapshot
 * // regeneration would use the same source rows.
 */
async function fetchSigHypotheses(
  session: Session,
  namespace: string,
  archetypeName: string,
): Promise<SigHypothesisRow[]> {
  const res = await session.run(
    `MATCH (c:Contract {archetypeName: $archetypeName, namespace: $namespace})
       -[:DECLARES_HYPOTHESIS]->(h:Hypothesis {namespace: $namespace})
     RETURN h.key AS key,
            h.text AS text,
            h.status AS status,
            h.verifiedAt AS verifiedAt
     ORDER BY h.key`,
    { namespace, archetypeName },
  );
  return res.records.map((rec) => ({
    key: rec.get('key') as string,
    text: ((rec.get('text') as string) ?? '').trim(),
    status: (rec.get('status') as string) ?? '',
    // Why: same Neo4j-DateTime quirk as in completeness-agent;
    // normalize early so the diff logic sees a string.
    verifiedAt: normalizeIsoString(rec.get('verifiedAt')),
  }));
}

/**
 * Find the most recent `RIGHT-BOOKEND-snapshot-YYYY-MM-DD.md` in
 * `archetypeDir`. Returns null if none exist (or the directory doesn't).
 */
async function findLatestSnapshot(archetypeDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(archetypeDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((n) => /^RIGHT-BOOKEND-snapshot-\d{4}-\d{2}-\d{2}.*\.md$/.test(n))
    .sort();
  if (candidates.length === 0) return null;
  // Sorted lexicographically by filename - the YYYY-MM-DD prefix makes
  // lexicographic order equivalent to chronological order. Newest last.
  return path.join(archetypeDir, candidates[candidates.length - 1]);
}

/**
 * Compare SIG rows against committed snapshot rows and emit findings.
 */
function diffRows(
  out: Finding[],
  archetype: string,
  sigRows: SigHypothesisRow[],
  committedRows: ParsedSnapshotRow[],
  snapshotPath: string,
): void {
  const sigByKey = new Map(sigRows.map((r) => [r.key, r]));
  const committedByKey = new Map(committedRows.map((r) => [r.key, r]));

  const allKeys = new Set<string>([...sigByKey.keys(), ...committedByKey.keys()]);
  const sortedKeys = [...allKeys].sort();
  let driftCount = 0;

  for (const key of sortedKeys) {
    const sig = sigByKey.get(key);
    const committed = committedByKey.get(key);

    if (sig && !committed) {
      driftCount++;
      out.push({
        agentName: AGENT_NAME,
        ruleId: 'bookend-audit:hypothesis-added',
        severity: 'warn',
        archetype,
        key,
        message: `Hypothesis ${key} present in SIG but missing from ${path.basename(snapshotPath)}.`,
        details: { sigStatus: sig.status },
      });
      continue;
    }
    if (committed && !sig) {
      driftCount++;
      out.push({
        agentName: AGENT_NAME,
        ruleId: 'bookend-audit:hypothesis-removed',
        severity: 'error',
        archetype,
        key,
        message: `Hypothesis ${key} present in ${path.basename(snapshotPath)} but missing from SIG.`,
        details: { committedStatus: committed.status },
      });
      continue;
    }
    // both present
    if (sig && committed && sig.status !== committed.status) {
      driftCount++;
      out.push({
        agentName: AGENT_NAME,
        ruleId: 'bookend-audit:status-drift',
        severity: 'warn',
        archetype,
        key,
        message: `Hypothesis ${key} status differs: SIG="${sig.status}" snapshot="${committed.status}".`,
        details: { sigStatus: sig.status, committedStatus: committed.status },
      });
    }
    // verifiedAt drift: the committed snapshot doesn't render verifiedAt
    // as a separate column, so we report only when the SIG has a value
    // that postdates the snapshot file (newer = expected after a
    // writeback; older = unexpected, but the committed file shape
    // doesn't carry the data, so this is fundamentally a SIG-only check
    // until the snapshot format grows a column). For now: if SIG has
    // a verifiedAt and committed status matches, emit info one-shot
    // when verifiedAt newer than the snapshot file's date encoded in
    // the filename.
    if (sig?.verifiedAt && committed) {
      const fileDate = extractSnapshotDate(snapshotPath);
      if (fileDate) {
        const verifiedMs = Date.parse(sig.verifiedAt);
        const fileMs = Date.parse(fileDate + 'T23:59:59Z');
        if (!Number.isNaN(verifiedMs) && !Number.isNaN(fileMs) && verifiedMs > fileMs) {
          driftCount++;
          out.push({
            agentName: AGENT_NAME,
            ruleId: 'bookend-audit:verifiedAt-drift',
            severity: 'info',
            archetype,
            key,
            message: `Hypothesis ${key} verifiedAt (${sig.verifiedAt}) is newer than snapshot file date (${fileDate}); regeneration may be due.`,
            details: { sigVerifiedAt: sig.verifiedAt, snapshotDate: fileDate },
          });
        }
      }
    }
  }
  if (driftCount === 0) {
    out.push({
      agentName: AGENT_NAME,
      ruleId: 'bookend-audit:in-sync',
      severity: 'info',
      archetype,
      message: `Committed snapshot (${path.basename(snapshotPath)}) matches SIG for ${archetype}.`,
      details: { hypothesisCount: sigRows.length },
    });
  }
}

/** Extract `YYYY-MM-DD` from a `RIGHT-BOOKEND-snapshot-YYYY-MM-DD...md` path. */
function extractSnapshotDate(snapshotPath: string): string | null {
  const m = path.basename(snapshotPath).match(/RIGHT-BOOKEND-snapshot-(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function makeDriver(opts: BookendAuditOptions): Driver {
  return neo4j.driver(
    opts.graphUrl ?? DEFAULT_GRAPH_URL,
    neo4j.auth.basic(
      opts.graphUser ?? DEFAULT_GRAPH_USER,
      opts.graphPass ?? DEFAULT_GRAPH_PASS,
    ),
  );
}
