/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §B.
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
 */

import type { Driver, Session } from 'neo4j-driver';
import neo4j from 'neo4j-driver';

import type { AgentReport, AgentRunOptions, Finding } from '../types.js';
import { summarize } from '../types.js';

export const AGENT_NAME = 'CompletenessAgent';
export const AGENT_VERSION = '0.1.0-pre';
const DEFAULT_NAMESPACE = 'asi';
const DEFAULT_GRAPH_URL = 'bolt://localhost:7689';
const DEFAULT_GRAPH_USER = 'neo4j';
const DEFAULT_GRAPH_PASS = 'udt-pass-2026';

/** Number of days after which a `held` hypothesis is considered stale. */
export const STALE_THRESHOLD_DAYS = 90;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Extended options for `runCompletenessAgent`. The `driver` and `now`
 * injection points exist for tests; production callers omit them.
 */
export interface CompletenessAgentOptions extends AgentRunOptions {
  /**
   * Optional pre-built driver. When supplied, the agent uses this and
   * does NOT close it (caller-owns-driver semantics). When omitted, the
   * agent builds one from `graphUrl/graphUser/graphPass` and closes it.
   */
  driver?: Driver;
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
 * Connection: when `opts.driver` is supplied it is used and not closed.
 * Otherwise the agent constructs a driver from `graphUrl/graphUser/
 * graphPass` (with sane defaults matching the rest of the asi adoption)
 * and closes it before returning.
 */
export async function runCompletenessAgent(
  opts: CompletenessAgentOptions = {},
): Promise<AgentReport> {
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const nowFn = opts.now ?? (() => new Date());
  const now = nowFn();
  const ranAt = now.toISOString();

  const ownsDriver = opts.driver === undefined;
  const driver: Driver = opts.driver ?? makeDriver(opts);
  const findings: Finding[] = [];
  try {
    const session = driver.session();
    try {
      findings.push(...(await checkHypotheses(session, namespace, now)));
      findings.push(...(await checkContractsWithoutHypotheses(session, namespace)));
      findings.push(...(await checkOrphanDataObjects(session, namespace)));
      findings.push(...(await checkServicesWithoutProcess(session, namespace)));
    } finally {
      await session.close();
    }
  } finally {
    if (ownsDriver) await driver.close();
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
 */
async function checkHypotheses(
  session: Session,
  namespace: string,
  now: Date,
): Promise<Finding[]> {
  const res = await session.run(
    `MATCH (c:Contract {namespace: $namespace})-[:DECLARES_HYPOTHESIS]->(h:Hypothesis {namespace: $namespace})
     RETURN c.archetypeName AS archetype,
            h.key AS key,
            h.status AS status,
            h.verifiedAt AS verifiedAt
     ORDER BY c.archetypeName, h.key`,
    { namespace },
  );
  const out: Finding[] = [];
  for (const rec of res.records) {
    const archetype = rec.get('archetype') as string;
    const key = rec.get('key') as string;
    const status = rec.get('status') as string;
    // Why: Neo4j may return verifiedAt as a DateTime temporal value
    // (from cypher) or as a string (after string-stored writebacks).
    // normalizeIsoString handles both so downstream comparators see a
    // consistent ISO-8601 string.
    const verifiedAt = normalizeIsoString(rec.get('verifiedAt'));
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
 */
async function checkContractsWithoutHypotheses(
  session: Session,
  namespace: string,
): Promise<Finding[]> {
  const res = await session.run(
    `MATCH (c:Contract {namespace: $namespace})
     OPTIONAL MATCH (c)-[:DECLARES_HYPOTHESIS]->(h:Hypothesis)
     WITH c, count(h) AS hypothesisCount
     WHERE hypothesisCount = 0
     RETURN c.archetypeName AS archetype
     ORDER BY archetype`,
    { namespace },
  );
  return res.records.map((rec) => ({
    agentName: AGENT_NAME,
    ruleId: 'completeness:contract-no-hypotheses',
    severity: 'warn' as const,
    archetype: rec.get('archetype') as string,
    message: `Contract ${rec.get('archetype')} declares zero hypotheses.`,
  }));
}

/**
 * Rule 6: orphan DataObject nodes.
 *
 * // Why: a DataObject with no incoming OWNS or PRODUCES edge has no
 * // owner in the contract graph; surfaces a likely gap in the
 * // archetype's ArchiMate-flavored ontology. Short-circuits when no
 * // DataObjects exist in the namespace at all (rule emits nothing).
 */
async function checkOrphanDataObjects(
  session: Session,
  namespace: string,
): Promise<Finding[]> {
  const res = await session.run(
    `MATCH (d:DataObject {namespace: $namespace})
     OPTIONAL MATCH (n)-[r:OWNS|PRODUCES]->(d)
     WITH d, count(r) AS incomingCount
     WHERE incomingCount = 0
     RETURN d.key AS key, coalesce(d.name, d.key) AS name
     ORDER BY key`,
    { namespace },
  );
  return res.records.map((rec) => ({
    agentName: AGENT_NAME,
    ruleId: 'completeness:dataobject-orphan',
    severity: 'info' as const,
    key: rec.get('key') as string,
    message: `DataObject ${rec.get('key')} (${rec.get('name')}) has no incoming OWNS/PRODUCES edge.`,
  }));
}

/**
 * Rule 7: Service with no associated Process.
 *
 * // Why: a Service nominally describes an external surface; if no
 * // Process exists to operate it, the archetype's runtime story is
 * // incomplete. Heuristic: a Service whose owning Contract has zero
 * // declared Processes triggers the rule. Short-circuits when no
 * // Service nodes exist in the namespace.
 */
async function checkServicesWithoutProcess(
  session: Session,
  namespace: string,
): Promise<Finding[]> {
  const res = await session.run(
    `MATCH (c:Contract {namespace: $namespace})-[:DECLARES_SERVICE]->(s:Service)
     OPTIONAL MATCH (c)-[:DECLARES_PROCESS]->(p:Process)
     WITH c, s, count(p) AS processCount
     WHERE processCount = 0
     RETURN c.archetypeName AS archetype, s.key AS key, coalesce(s.name, s.key) AS name
     ORDER BY archetype, key`,
    { namespace },
  );
  return res.records.map((rec) => ({
    agentName: AGENT_NAME,
    ruleId: 'completeness:service-no-process',
    severity: 'info' as const,
    archetype: rec.get('archetype') as string,
    key: rec.get('key') as string,
    message: `Service ${rec.get('key')} (${rec.get('name')}) on ${rec.get('archetype')} has no associated Process.`,
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
 *
 * // Why: the agent's rules and the JSON `details` shape both want a
 * // string. Without this normalization the report renders Neo4j's
 * // internal `{year:{low, high}, month:{...}, ...}` structure which is
 * // unreadable.
 */
export function normalizeIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  // Neo4j DateTime temporal value: has `toString()` returning ISO format.
  if (typeof value === 'object' && 'toString' in value) {
    const s = (value as { toString(): string }).toString();
    // Why: Neo4j's DateTime.toString produces ISO-8601, but Object's
    // default toString returns '[object Object]'. Guard against the
    // latter so we surface null rather than rendering noise.
    if (s === '[object Object]') return null;
    return s;
  }
  return null;
}

function makeDriver(opts: CompletenessAgentOptions): Driver {
  return neo4j.driver(
    opts.graphUrl ?? DEFAULT_GRAPH_URL,
    neo4j.auth.basic(
      opts.graphUser ?? DEFAULT_GRAPH_USER,
      opts.graphPass ?? DEFAULT_GRAPH_PASS,
    ),
  );
}
