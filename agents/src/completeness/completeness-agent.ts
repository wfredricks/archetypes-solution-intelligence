/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §B.
 *
 *   Refactored 2026-05-22 under BUILD-PHASE-2_5-PLAN.md §2.5.2/2.5.3
 *   to consume the Backend adapter (lifted pattern from contract-
 *   loader/src/backends/) so this agent runs against either Neo4j
 *   or PolyGraph. Public function signature unchanged.
 *
 *   Ownership: asi-local. solution-intel archetype's first agent
 *   surface; this package becomes ./reference-impl/agents/ in the
 *   archetype's next snapshot lift.
 *
 * @module completeness/completeness-agent
 */

/**
 * `CompletenessAgent` — walks the SIG for one namespace and emits
 * findings about gaps. Read-only.
 *
 * // Why: operators need a way to ask "what should I look at?" without
 * // remembering which Cypher patterns surface which gaps. This agent
 * // codifies seven well-defined questions and emits findings for each
 * // hit. Re-runnable any time; output is deterministic for a given
 * // SIG state.
 *
 * // Idempotency: read-only. Re-running on an unchanged SIG produces
 * // an identical report (modulo `ranAt`).
 *
 * // Backend dispatch: this file is backend-agnostic at the public
 * // surface; internally it uses `selectBackend(opts)` and routes the
 * // three aggregation rules (sites 2/3/4) through native helpers on
 * // PolyGraph while keeping their cypher form on Neo4j. See §2.5.3.
 */

import type { Driver } from 'neo4j-driver';

import { selectBackend } from '../backends/select.js';
import type { Backend } from '../backends/types.js';
import type { AgentReport, AgentRunOptions, Finding } from '../types.js';
import { summarize } from '../types.js';

export const AGENT_NAME = 'CompletenessAgent';
export const AGENT_VERSION = '0.2.0-pre';
const DEFAULT_NAMESPACE = 'asi';

/** Number of days after which a `held` hypothesis is considered stale. */
export const STALE_THRESHOLD_DAYS = 90;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Extended options for `runCompletenessAgent`. The `driver` and `now`
 * injection points exist for tests; production callers omit them.
 *
 * Phase 2.5 adds two optional fields — `backend` and `polygraphPath`
 * — passed through to the backend adapter. Selection precedence is
 * documented in `backends/types.ts` `resolveBackendKind`.
 */
export interface CompletenessAgentOptions extends AgentRunOptions {
  /**
   * Optional pre-built driver. When supplied, the agent uses this and
   * does NOT close it (caller-owns-driver semantics). When omitted, the
   * agent builds one from `graphUrl/graphUser/graphPass` and closes it.
   */
  driver?: Driver;
  /** Optional explicit backend selector (Phase 2.5). */
  backend?: 'neo4j' | 'polygraph';
  /** Optional leveldb path when using the polygraph backend (Phase 2.5). */
  polygraphPath?: string;
  /**
   * Optional clock override for tests. Returns the value used as
   * "now" for staleness comparison and as `ranAt`. Defaults to
   * `() => new Date()`.
   */
  now?: () => Date;
}

/**
 * Runs the CompletenessAgent against the SIG and returns its report.
 *
 * Connection: the agent obtains a {@link Backend} via `selectBackend`
 * (see backends/types.ts for precedence). When `opts.driver` is
 * supplied the Neo4j backend wraps it without taking ownership;
 * otherwise the backend opens (and closes) its own connection.
 */
export async function runCompletenessAgent(
  opts: CompletenessAgentOptions = {},
): Promise<AgentReport> {
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const nowFn = opts.now ?? (() => new Date());
  const now = nowFn();
  const ranAt = now.toISOString();

  const backend = await selectBackend({
    driver: opts.driver,
    backend: opts.backend,
    graphUrl: opts.graphUrl,
    graphUser: opts.graphUser,
    graphPass: opts.graphPass,
    polygraphPath: opts.polygraphPath,
  });
  const findings: Finding[] = [];
  try {
    findings.push(...(await checkHypotheses(backend, namespace, now)));
    findings.push(...(await checkContractsWithoutHypotheses(backend, namespace)));
    findings.push(...(await checkOrphanDataObjects(backend, namespace)));
    findings.push(...(await checkServicesWithoutProcess(backend, namespace)));
  } finally {
    await backend.close();
  }

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
 * Rule 1-4: hypothesis status sweep + staleness.
 *
 * // Why: one query pulls every Hypothesis declared by a Contract in
 * // the namespace; the rule classifier walks the result set rather
 * // than firing four separate queries.
 *
 * // Bridge-compatible site: simple MATCH+RETURN with inline-property
 * // filters. Both backends use cypher here.
 */
async function checkHypotheses(
  backend: Backend,
  namespace: string,
  now: Date,
): Promise<Finding[]> {
  const records = await backend.query(
    `MATCH (c:Contract {namespace: $namespace})-[:DECLARES_HYPOTHESIS]->(h:Hypothesis {namespace: $namespace})
     RETURN c.archetypeName AS archetype,
            h.key AS key,
            h.status AS status,
            h.verifiedAt AS verifiedAt
     ORDER BY c.archetypeName, h.key`,
    { namespace },
  );
  const out: Finding[] = [];
  for (const rec of records) {
    const archetype = rec.archetype as string;
    const key = rec.key as string;
    const status = rec.status as string;
    // Why: Neo4j may return verifiedAt as a DateTime temporal value
    // (from cypher) or as a string (after string-stored writebacks).
    // normalizeIsoString handles both so downstream comparators see a
    // consistent ISO-8601 string.
    const verifiedAt = normalizeIsoString(rec.verifiedAt);
    switch (status) {
      case 'open':
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:hypothesis-open',
          severity: 'info',
          archetype,
          key,
          message: `Hypothesis ${key} is open (expected for un-adopted archetypes).`,
          details: { status, verifiedAt },
        });
        break;
        case 'partial':
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:hypothesis-partial',
          severity: 'warn',
          archetype,
          key,
          message: `Hypothesis ${key} has partial evidence.`,
          details: { status, verifiedAt },
        });
        break;
      case 'violated':
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:hypothesis-violated',
          severity: 'error',
          archetype,
          key,
          message: `Hypothesis ${key} is violated.`,
          details: { status, verifiedAt },
        });
        break;
      case 'held': {
        // Why: a held hypothesis is the happy case for everything
        // except staleness. A held-without-verifiedAt almost certainly
        // pre-dates the F1 contract-loader change; treat as stale so
        // operators are nudged to re-verify.
        const stale = isStale(verifiedAt, now);
        if (stale) {
          out.push({
            agentName: AGENT_NAME,
            ruleId: 'completeness:hypothesis-stale',
            severity: 'warn',
            archetype,
            key,
            message: verifiedAt
              ? `Hypothesis ${key} held but verifiedAt is older than ${STALE_THRESHOLD_DAYS} days.`
              : `Hypothesis ${key} held but verifiedAt is null (pre-F1 hypothesis or never verified).`,
            details: { status, verifiedAt },
          });
        }
        break;
      }
      default:
        // Unknown status: surface as a warning so we notice when the
        // ontology grows a new status value without updating the agent.
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:hypothesis-partial',
          severity: 'warn',
          archetype,
          key,
          message: `Hypothesis ${key} has unrecognized status "${status}"; surfacing as partial.`,
          details: { status, verifiedAt },
        });
    }
  }
  return out;
}

/**
 * Rule 5: contracts with zero `DECLARES_HYPOTHESIS` edges.
 *
 * // Why: a contract without hypotheses cannot ever leave `untested`
 * // territory - it has nothing to test. Either the archetype really
 * // is intentionally hypothesis-free (rare) or the bookend wasn't
 * // fully parsed.
 *
 * // Backend split (Phase 2.5): Neo4j uses the original
 * // OPTIONAL MATCH cypher; PolyGraph walks Contracts via findNodes
 * // and counts outgoing DECLARES_HYPOTHESIS edges via
 * // backend.native.countOutgoingRels. The bridge does not handle
 * // OPTIONAL MATCH + WITH + count(...) — qengine territory.
 */
async function checkContractsWithoutHypotheses(
  backend: Backend,
  namespace: string,
): Promise<Finding[]> {
  if (backend.kind === 'polygraph') {
    // Native path: find Contracts in namespace, count outgoing
    // DECLARES_HYPOTHESIS edges per contract, keep those with 0.
    const contracts = await backend.native.findNodes('Contract', { namespace });
    const out: Finding[] = [];
    for (const c of contracts) {
      const count = await backend.native.countOutgoingRels(c.id, ['DECLARES_HYPOTHESIS']);
      if (count === 0) {
        const archetype = c.properties.archetypeName as string;
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:contract-no-hypotheses',
          severity: 'warn',
          archetype,
          message: `Contract ${archetype} declares zero hypotheses.`,
        });
      }
    }
    // Deterministic ordering — matches the Neo4j ORDER BY archetype.
    out.sort((a, b) => String(a.archetype).localeCompare(String(b.archetype)));
    return out;
  }
  const records = await backend.query(
    `MATCH (c:Contract {namespace: $namespace})
     OPTIONAL MATCH (c)-[:DECLARES_HYPOTHESIS]->(h:Hypothesis)
     WITH c, count(h) AS hypothesisCount
     WHERE hypothesisCount = 0
     RETURN c.archetypeName AS archetype
     ORDER BY archetype`,
    { namespace },
  );
  return records.map((rec) => ({
    agentName: AGENT_NAME,
    ruleId: 'completeness:contract-no-hypotheses',
    severity: 'warn' as const,
    archetype: rec.archetype as string,
    message: `Contract ${rec.archetype} declares zero hypotheses.`,
  }));
}

/**
 * Rule 6: orphan DataObject nodes.
 *
 * // Why: a DataObject with no incoming OWNS or PRODUCES edge has no
 * // owner in the contract graph; surfaces a likely gap in the
 * // archetype's ArchiMate-flavored ontology.
 *
 * // Backend split (Phase 2.5): see checkContractsWithoutHypotheses
 * // header — same rationale. PolyGraph walks DataObjects and counts
 * // incoming OWNS|PRODUCES edges natively.
 */
async function checkOrphanDataObjects(
  backend: Backend,
  namespace: string,
): Promise<Finding[]> {
  if (backend.kind === 'polygraph') {
    const objects = await backend.native.findNodes('DataObject', { namespace });
    const out: Finding[] = [];
    for (const d of objects) {
      const count = await backend.native.countIncomingRels(d.id, ['OWNS', 'PRODUCES']);
      if (count === 0) {
        const key = d.properties.key as string;
        const name = (d.properties.name as string | undefined) ?? key;
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:dataobject-orphan',
          severity: 'info',
          key,
          message: `DataObject ${key} (${name}) has no incoming OWNS/PRODUCES edge.`,
        });
      }
    }
    out.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    return out;
  }
  const records = await backend.query(
    `MATCH (d:DataObject {namespace: $namespace})
     OPTIONAL MATCH (n)-[r:OWNS|PRODUCES]->(d)
     WITH d, count(r) AS incomingCount
     WHERE incomingCount = 0
     RETURN d.key AS key, coalesce(d.name, d.key) AS name
     ORDER BY key`,
    { namespace },
  );
  return records.map((rec) => ({
    agentName: AGENT_NAME,
    ruleId: 'completeness:dataobject-orphan',
    severity: 'info' as const,
    key: rec.key as string,
    message: `DataObject ${rec.key} (${rec.name}) has no incoming OWNS/PRODUCES edge.`,
  }));
}

/**
 * Rule 7: Service with no associated Process.
 *
 * // Why: a Service nominally describes an external surface; if no
 * // Process exists to operate it, the archetype's runtime story is
 * // incomplete. Heuristic: a Service whose owning Contract has zero
 * // declared Processes triggers the rule.
 *
 * // Backend split (Phase 2.5): PolyGraph walks every Contract in
 * // namespace, collects its DECLARES_SERVICE outgoing rels (the
 * // Services), and emits one finding per Service iff the Contract
 * // has zero DECLARES_PROCESS outgoing rels. We materialize Services
 * // by joining the DECLARES_SERVICE edge to its target.
 */
async function checkServicesWithoutProcess(
  backend: Backend,
  namespace: string,
): Promise<Finding[]> {
  if (backend.kind === 'polygraph') {
    const contracts = await backend.native.findNodes('Contract', { namespace });
    const out: Finding[] = [];
    // Per-Contract: count Processes; if zero, emit one finding per Service.
    for (const c of contracts) {
      const processCount = await backend.native.countOutgoingRels(c.id, ['DECLARES_PROCESS']);
      if (processCount !== 0) continue;
      // Walk DECLARES_SERVICE outgoing from this Contract.
      const archetype = c.properties.archetypeName as string;
      // We need the Service nodes themselves (for key/name), so use
      // findRelationships('DECLARES_SERVICE') filtered to this contract.
      // PolyGraph's findRelationships matches on property filter only,
      // so we materialize the whole DECLARES_SERVICE set once and
      // then filter by startNode === c.id.
      //
      // Why we don't cache the full set across contracts: the loop
      // visits every Contract in the namespace; caching the full rel
      // set once outside the loop would be more efficient but mixes
      // concerns. For the dla-stores SIG (no Services loaded as of
      // Phase 2) this branch produces zero findings, so the
      // simplicity wins.
      const serviceRels = await backend.native.findRelationships('DECLARES_SERVICE');
      const myRels = serviceRels.filter((r) => r.startNode === c.id);
      for (const r of myRels) {
        const services = await backend.native.findNodes('Service');
        const svc = services.find((s) => s.id === r.endNode);
        if (!svc) continue;
        const key = svc.properties.key as string;
        const name = (svc.properties.name as string | undefined) ?? key;
        out.push({
          agentName: AGENT_NAME,
          ruleId: 'completeness:service-no-process',
          severity: 'info',
          archetype,
          key,
          message: `Service ${key} (${name}) on ${archetype} has no associated Process.`,
        });
      }
    }
    out.sort((a, b) => {
      const c = String(a.archetype).localeCompare(String(b.archetype));
      if (c !== 0) return c;
      return String(a.key).localeCompare(String(b.key));
    });
    return out;
  }
  const records = await backend.query(
    `MATCH (c:Contract {namespace: $namespace})-[:DECLARES_SERVICE]->(s:Service)
     OPTIONAL MATCH (c)-[:DECLARES_PROCESS]->(p:Process)
     WITH c, s, count(p) AS processCount
     WHERE processCount = 0
     RETURN c.archetypeName AS archetype, s.key AS key, coalesce(s.name, s.key) AS name
     ORDER BY archetype, key`,
    { namespace },
  );
  return records.map((rec) => ({
    agentName: AGENT_NAME,
    ruleId: 'completeness:service-no-process',
    severity: 'info' as const,
    archetype: rec.archetype as string,
    key: rec.key as string,
    message: `Service ${rec.key} (${rec.name}) on ${rec.archetype} has no associated Process.`,
  }));
}

/**
 * Returns true when `verifiedAt` indicates staleness given `now`.
 * `null`/empty `verifiedAt` always reads as stale (we can't prove the
 * hypothesis was ever verified).
 */
export function isStale(verifiedAt: string | null | undefined, now: Date): boolean {
  if (!verifiedAt) return true;
  const ts = Date.parse(verifiedAt);
  if (Number.isNaN(ts)) return true;
  return now.getTime() - ts > STALE_THRESHOLD_MS;
}

/**
 * Coerce a Neo4j-returned verifiedAt value to an ISO-8601 string (or
 * null). Neo4j returns `DateTime` temporal values for `datetime()`-typed
 * columns; older string-stored writebacks come through unchanged.
 */
export function normalizeIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  // Neo4j DateTime temporal value: has `toString()` returning ISO format.
  if (typeof value === 'object' && 'toString' in value) {
    const s = (value as { toString(): string }).toString();
    if (s === '[object Object]') return null;
    return s;
  }
  return null;
}
