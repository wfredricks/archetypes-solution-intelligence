/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase D.
 *
 *   Ownership: asi-local. Writes the ArchiMate-flavored SIG ontology
 *   committed in `archetypes/events-spine/LEFT-BOOKEND.md` to PolyGraph.
 */

/**
 * Commits a {@link ContractGraph} to PolyGraph, anchored to the Solution
 * root identified by `namespace`.
 *
 * // Why: The parser is pure (file → object); the committer is the
 * // I/O layer. Keeping them separate lets us unit-test parsing without
 * // a graph, and lets the committer be the single source of truth for
 * // Cypher shape — anyone who needs to read these contracts back goes
 * // through commitContract() to know what it wrote.
 *
 * // Idempotency: the committer first DETACH DELETE-s every node tagged
 * // with the same contractId, then inserts. Re-running with the same
 * // ContractGraph leaves the graph in the same state. Re-running with a
 * // modified ContractGraph replaces the contract atomically (well: in a
 * // single session; PolyGraph here is single-instance so there's no
 * // multi-writer race).
 *
 * // What gets written:
 * //   1. Contract envelope node tagged with contractId + namespace
 * //   2. One sub-node per Principle/Constraint/Service/Process/DataObject/Hypothesis,
 * //      each tagged with contractId + namespace
 * //   3. DECLARES_* edges from Contract to each sub-node
 * //   4. HAS_CONTRACT edge from the Solution root to the new Contract
 * //   5. COMPOSES edges to other Contract nodes if any (matched by
 * //      archetypeName; missing children are silently skipped — they may
 * //      not exist yet)
 *
 * @module commit-contract
 */

import type { Driver } from 'neo4j-driver';
import neo4j from 'neo4j-driver';

import type { ContractGraph } from './types.js';

export interface CommitOptions {
  /** Solution root namespace this contract anchors to (e.g. "asi"). */
  namespace: string;
  /** Bolt URL (defaults to bolt://localhost:7689). */
  graphUrl?: string;
  /** Auth user (defaults to neo4j). */
  graphUser?: string;
  /** Auth password (defaults to udt-pass-2026 per TOOLS.md). */
  graphPass?: string;
  /**
   * Optional caller-provided driver. When supplied, the committer uses
   * it directly and does NOT close it (the caller owns lifecycle).
   *
   * // Why: tests want to share one driver across many commits without
   * // paying connect/teardown cost per call.
   */
  driver?: Driver;
}

export interface CommitSummary {
  contractId: string;
  nodeCount: number;
  edgeCount: number;
  anchoredTo: string;
}

/** Default Bolt URL — matches scripts/seed-solution.ts. */
const DEFAULT_GRAPH_URL = 'bolt://localhost:7689';
const DEFAULT_GRAPH_USER = 'neo4j';
const DEFAULT_GRAPH_PASS = 'udt-pass-2026';

/**
 * Commits the contract graph. Returns a summary suitable for printing or
 * test assertions.
 */
export async function commitContract(
  graph: ContractGraph,
  options: CommitOptions,
): Promise<CommitSummary> {
  const ownsDriver = options.driver === undefined;
  const driver =
    options.driver ??
    neo4j.driver(
      options.graphUrl ?? DEFAULT_GRAPH_URL,
      neo4j.auth.basic(
        options.graphUser ?? DEFAULT_GRAPH_USER,
        options.graphPass ?? DEFAULT_GRAPH_PASS,
      ),
    );
  try {
    return await doCommit(driver, graph, options.namespace);
  } finally {
    if (ownsDriver) await driver.close();
  }
}

async function doCommit(
  driver: Driver,
  graph: ContractGraph,
  namespace: string,
): Promise<CommitSummary> {
  const { contract } = graph;
  const session = driver.session();
  try {
    // 0) Pre-check the anchor exists. We refuse to create any Contract or
    //    sub-nodes if there is no Solution to anchor to — otherwise a
    //    failure mid-commit would leak orphan nodes into the namespace.
    const anchorCheck = await session.run(
      `MATCH (s:Solution {namespace: $namespace}) RETURN s.name AS name`,
      { namespace },
    );
    if (anchorCheck.records.length === 0) {
      throw new Error(
        `commit-contract: no Solution node found for namespace="${namespace}"; ` +
          'run scripts/seed-solution.ts first.',
      );
    }

    // 1) Idempotent clear: drop any prior contract with this contractId
    //    AND any sub-nodes tagged with the same contractId. The
    //    namespace property scopes the wipe to this adoption.
    await session.run(
      `MATCH (n {contractId: $contractId, namespace: $namespace}) DETACH DELETE n`,
      { contractId: contract.contractId, namespace },
    );

    // 2) Create the Contract envelope.
    await session.run(
      `CREATE (c:Contract {
         contractId: $contractId,
         namespace: $namespace,
         archetypeName: $archetypeName,
         archetypeKind: $archetypeKind,
         archetypeVersion: $archetypeVersion,
         sourceBookend: $sourceBookend,
         loadedAt: datetime()
       })`,
      {
        contractId: contract.contractId,
        namespace,
        archetypeName: contract.archetypeName,
        archetypeKind: contract.archetypeKind,
        archetypeVersion: contract.archetypeVersion,
        sourceBookend: contract.sourceBookend,
      },
    );

    let nodeCount = 1; // Contract itself
    let edgeCount = 0;

    // 3) Sub-nodes + DECLARES_* edges
    for (const p of graph.principles) {
      await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})
         CREATE (p:Principle {
           key: $key, name: $name, driver: $driver,
           consequences: $consequences, alternativeConsidered: $alt,
           contractId: $contractId, namespace: $namespace
         })
         CREATE (c)-[:DECLARES_PRINCIPLE]->(p)`,
        {
          contractId: contract.contractId,
          namespace,
          key: p.key,
          name: p.name,
          driver: p.driver,
          consequences: p.consequences,
          alt: p.alternativeConsidered,
        },
      );
      nodeCount += 1;
      edgeCount += 1;
    }

    for (const c of graph.constraints) {
      await session.run(
        `MATCH (ct:Contract {contractId: $contractId, namespace: $namespace})
         CREATE (n:Constraint {
           key: $key, name: $name, rationale: $rationale,
           contractId: $contractId, namespace: $namespace
         })
         CREATE (ct)-[:DECLARES_CONSTRAINT]->(n)`,
        {
          contractId: contract.contractId,
          namespace,
          key: c.key,
          name: c.name,
          rationale: c.rationale,
        },
      );
      nodeCount += 1;
      edgeCount += 1;
    }

    for (const s of graph.services) {
      await session.run(
        `MATCH (ct:Contract {contractId: $contractId, namespace: $namespace})
         CREATE (n:Service {
           key: $key, name: $name, signature: $signature, description: $description,
           contractId: $contractId, namespace: $namespace
         })
         CREATE (ct)-[:DECLARES_SERVICE]->(n)`,
        {
          contractId: contract.contractId,
          namespace,
          key: s.key,
          name: s.name,
          signature: s.signature,
          description: s.description,
        },
      );
      nodeCount += 1;
      edgeCount += 1;
    }

    for (const pr of graph.processes) {
      await session.run(
        `MATCH (ct:Contract {contractId: $contractId, namespace: $namespace})
         CREATE (n:Process {
           key: $key, name: $name, trigger: $trigger, cadence: $cadence,
           description: $description,
           contractId: $contractId, namespace: $namespace
         })
         CREATE (ct)-[:DECLARES_PROCESS]->(n)`,
        {
          contractId: contract.contractId,
          namespace,
          key: pr.key,
          name: pr.name,
          trigger: pr.trigger,
          cadence: pr.cadence,
          description: pr.description,
        },
      );
      nodeCount += 1;
      edgeCount += 1;
    }

    for (const d of graph.dataObjects) {
      await session.run(
        `MATCH (ct:Contract {contractId: $contractId, namespace: $namespace})
         CREATE (n:DataObject {
           key: $key, name: $name, description: $description, schemaHint: $schemaHint,
           contractId: $contractId, namespace: $namespace
         })
         CREATE (ct)-[:DECLARES_DATAOBJECT]->(n)`,
        {
          contractId: contract.contractId,
          namespace,
          key: d.key,
          name: d.name,
          description: d.description,
          schemaHint: d.schemaHint,
        },
      );
      nodeCount += 1;
      edgeCount += 1;
    }

    for (const h of graph.hypotheses) {
      // Why: verifiedAt is set to `null` for parsed-from-bookend
      // hypotheses; writeback scripts later patch it to an ISO-8601
      // timestamp via a separate SET clause on the existing node.
      // Including it in the initial CREATE keeps the property surface
      // consistent (no implicit undefined → missing-property reads).
      await session.run(
        `MATCH (ct:Contract {contractId: $contractId, namespace: $namespace})
         CREATE (n:Hypothesis {
           key: $key, text: $text, status: $status, verifiedAt: $verifiedAt,
           contractId: $contractId, namespace: $namespace
         })
         CREATE (ct)-[:DECLARES_HYPOTHESIS]->(n)`,
        {
          contractId: contract.contractId,
          namespace,
          key: h.key,
          text: h.text,
          status: h.status,
          verifiedAt: h.verifiedAt ?? null,
        },
      );
      nodeCount += 1;
      edgeCount += 1;
    }

    // 4) Anchor to the Solution root (idempotent via MERGE). Existence
    //    of the Solution was already proven by step 0.
    const anchorRes = await session.run(
      `MATCH (s:Solution {namespace: $namespace})
       MATCH (c:Contract {contractId: $contractId, namespace: $namespace})
       MERGE (s)-[:HAS_CONTRACT]->(c)
       RETURN s.name AS solutionName`,
      { namespace, contractId: contract.contractId },
    );
    edgeCount += 1;

    // 5) COMPOSES edges to peer Contracts (where they exist).
    for (const childName of graph.composes) {
      const linkRes = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})
         MATCH (child:Contract {archetypeName: $childName, namespace: $namespace})
         MERGE (c)-[:COMPOSES]->(child)
         RETURN count(child) AS linked`,
        {
          contractId: contract.contractId,
          namespace,
          childName,
        },
      );
      const linked = linkRes.records[0]?.get('linked').toNumber?.() ?? 0;
      if (linked > 0) edgeCount += linked;
      // Missing children are intentional: events-spine composes
      // simple-pubsub / simple-subscriber / scribe / mcp-proxy, none of
      // which have Contracts yet. The COMPOSES edge will be created when
      // those contracts are loaded and a re-commit of events-spine runs.
    }

    const solutionName =
      anchorRes.records[0]?.get('solutionName') ?? anchorCheck.records[0].get('name');
    return {
      contractId: contract.contractId,
      nodeCount,
      edgeCount,
      anchoredTo: solutionName,
    };
  } finally {
    await session.close();
  }
}

/**
 * Reads a previously-committed contract back from the graph and returns
 * counts. Useful for round-trip verification.
 */
export async function verifyContract(
  contractId: string,
  namespace: string,
  options: Omit<CommitOptions, 'namespace'> & { namespace?: never } = {},
): Promise<{
  contractId: string;
  nodeCount: number;
  edgeCount: number;
  hasAnchor: boolean;
}> {
  const ownsDriver = options.driver === undefined;
  const driver =
    options.driver ??
    neo4j.driver(
      options.graphUrl ?? DEFAULT_GRAPH_URL,
      neo4j.auth.basic(
        options.graphUser ?? DEFAULT_GRAPH_USER,
        options.graphPass ?? DEFAULT_GRAPH_PASS,
      ),
    );
  try {
    const session = driver.session();
    try {
      const res = await session.run(
        `OPTIONAL MATCH (s:Solution {namespace: $namespace})-[:HAS_CONTRACT]->(c:Contract {contractId: $contractId})
         WITH c
         OPTIONAL MATCH (n {contractId: $contractId, namespace: $namespace})
         WITH c, count(DISTINCT n) AS nodeCount
         OPTIONAL MATCH (n2 {contractId: $contractId, namespace: $namespace})-[r]->()
         RETURN
           c IS NOT NULL AS hasContract,
           nodeCount AS nodeCount,
           count(DISTINCT r) AS outgoingEdges`,
        { namespace, contractId },
      );
      const r = res.records[0];
      const hasAnchor = r?.get('hasContract') === true;
      const nodeCount = r?.get('nodeCount').toNumber?.() ?? 0;
      const edgeCount = r?.get('outgoingEdges').toNumber?.() ?? 0;
      return { contractId, nodeCount, edgeCount, hasAnchor };
    } finally {
      await session.close();
    }
  } finally {
    if (ownsDriver) await driver.close();
  }
}
