/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase D.
 *
 *   Refactored 2026-05-22 under BUILD-PHASE-1E-PLAN.md §1e.2 to route
 *   all storage through the new {@link Backend} interface, so the same
 *   committer drives either Neo4j or PolyGraph. The public function
 *   signatures of `commitContract` and `verifyContract` are unchanged.
 *
 *   Ownership: asi-local. Writes the ArchiMate-flavored SIG ontology
 *   committed in `archetypes/events-spine/LEFT-BOOKEND.md` to the
 *   selected backend.
 */

/**
 * Commits a {@link ContractGraph} to the configured graph backend,
 * anchored to the Solution root identified by `namespace`.
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
 * // modified ContractGraph replaces the contract atomically.
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

import type { ContractGraph } from './types.js';
import type { Backend, BackendOptions } from './backends/types.js';
import { selectBackend } from './backends/select.js';

export interface CommitOptions {
  /** Solution root namespace this contract anchors to (e.g. "asi"). */
  namespace: string;
  /** Bolt URL (defaults to bolt://localhost:7689). Neo4j only. */
  graphUrl?: string;
  /** Auth user (defaults to neo4j). Neo4j only. */
  graphUser?: string;
  /** Auth password (defaults to udt-pass-2026 per TOOLS.md). Neo4j only. */
  graphPass?: string;
  /**
   * Optional caller-provided driver. When supplied, the committer uses
   * it directly and does NOT close it (the caller owns lifecycle).
   * Neo4j only.
   *
   * // Why: tests want to share one driver across many commits without
   * // paying connect/teardown cost per call.
   */
  driver?: Driver;
  /**
   * Explicit backend selector. Defaults are governed by the precedence
   * rules in `backends/types.ts` §`resolveBackendKind`:
   *   1. `driver` supplied → 'neo4j'
   *   2. `backend === 'polygraph'` → 'polygraph'
   *   3. `polygraphPath` set → 'polygraph'
   *   4. `graphUrl` startsWith bolt:// → 'neo4j'
   *   5. default → 'neo4j' (preserves Phase 1c behavior)
   *
   * @since 0.2.0-pre (Phase 1e)
   */
  backend?: 'neo4j' | 'polygraph';
  /**
   * Leveldb directory for the embedded PolyGraph backend. Required
   * when `backend === 'polygraph'` and no other selector matches.
   *
   * @since 0.2.0-pre (Phase 1e)
   */
  polygraphPath?: string;
}

export interface CommitSummary {
  contractId: string;
  nodeCount: number;
  edgeCount: number;
  anchoredTo: string;
}

/**
 * Commits the contract graph. Returns a summary suitable for printing or
 * test assertions.
 *
 * // Why the signature is unchanged from Phase 1c: `commitContract(graph,
 * // options)` is the public surface; the Backend selection happens
 * // inside, driven by the option fields above. Existing callers see no
 * // behavior difference unless they opt into the PolyGraph backend.
 */
export async function commitContract(
  graph: ContractGraph,
  options: CommitOptions,
): Promise<CommitSummary> {
  const backend = await selectBackend(toBackendOptions(options));
  try {
    return await doCommit(backend, graph, options.namespace);
  } finally {
    await backend.close();
  }
}

function toBackendOptions(options: CommitOptions): BackendOptions {
  return {
    backend: options.backend,
    graphUrl: options.graphUrl,
    graphUser: options.graphUser,
    graphPass: options.graphPass,
    driver: options.driver,
    polygraphPath: options.polygraphPath,
  };
}

async function doCommit(
  backend: Backend,
  graph: ContractGraph,
  namespace: string,
): Promise<CommitSummary> {
  const { contract } = graph;

  // 0) Pre-check the anchor exists. We refuse to create any Contract or
  //    sub-nodes if there is no Solution to anchor to — otherwise a
  //    failure mid-commit would leak orphan nodes into the namespace.
  const anchorCheck = await backend.query(
    `MATCH (s:Solution {namespace: $namespace}) RETURN s.name AS name`,
    { namespace },
  );
  if (anchorCheck.length === 0) {
    throw new Error(
      `commit-contract: no Solution node found for namespace="${namespace}"; ` +
        'run scripts/seed-solution.ts first.',
    );
  }

  // 1) Idempotent clear: drop any prior contract with this contractId
  //    AND any sub-nodes tagged with the same contractId. The
  //    namespace property scopes the wipe to this adoption.
  await backend.query(
    `MATCH (n {contractId: $contractId, namespace: $namespace}) DETACH DELETE n`,
    { contractId: contract.contractId, namespace },
  );

  // 2) Create the Contract envelope.
  //
  // // Why a string timestamp instead of `datetime()`: PolyGraph's
  // // cypher bridge does not implement function calls in property
  // // expressions, and the property is consumed as an ISO string
  // // by every downstream reader (the CLI, the writeback scripts,
  // // the snapshot tooling). Pre-computing the ISO string here makes
  // // the cypher backend-portable. Neo4j stores it as a string;
  // // previous Phase 1c behavior wrote a native DateTime, which no
  // // consumer ever read as a DateTime — only stringified. The
  // // shape difference is invisible to every downstream caller.
  const loadedAt = new Date().toISOString();
  await backend.query(
    `CREATE (c:Contract {
       contractId: $contractId,
       namespace: $namespace,
       archetypeName: $archetypeName,
       archetypeKind: $archetypeKind,
       archetypeVersion: $archetypeVersion,
       sourceBookend: $sourceBookend,
       loadedAt: $loadedAt
     })`,
    {
      contractId: contract.contractId,
      namespace,
      archetypeName: contract.archetypeName,
      archetypeKind: contract.archetypeKind,
      archetypeVersion: contract.archetypeVersion,
      sourceBookend: contract.sourceBookend,
      loadedAt,
    },
  );

  let nodeCount = 1; // Contract itself
  let edgeCount = 0;

  // 3) Sub-nodes + DECLARES_* edges
  for (const p of graph.principles) {
    await backend.query(
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
    await backend.query(
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
    await backend.query(
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
    await backend.query(
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
    await backend.query(
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
    await backend.query(
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
  const anchorRes = await backend.query(
    `MATCH (s:Solution {namespace: $namespace})
     MATCH (c:Contract {contractId: $contractId, namespace: $namespace})
     MERGE (s)-[:HAS_CONTRACT]->(c)
     RETURN s.name AS solutionName`,
    { namespace, contractId: contract.contractId },
  );
  edgeCount += 1;

  // 5) COMPOSES edges to peer Contracts (where they exist).
  for (const childName of graph.composes) {
    const linkRes = await backend.query(
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
    const linkedRaw = linkRes[0]?.linked;
    const linked = typeof linkedRaw === 'number' ? linkedRaw : Number(linkedRaw ?? 0);
    if (linked > 0) edgeCount += linked;
    // Missing children are intentional: events-spine composes
    // simple-pubsub / simple-subscriber / scribe / mcp-proxy, none of
    // which have Contracts yet. The COMPOSES edge will be created when
    // those contracts are loaded and a re-commit of events-spine runs.
  }

  const solutionName =
    (anchorRes[0]?.solutionName as string | undefined) ??
    (anchorCheck[0]?.name as string);
  return {
    contractId: contract.contractId,
    nodeCount,
    edgeCount,
    anchoredTo: solutionName,
  };
}

/**
 * Reads a previously-committed contract back from the graph and returns
 * counts. Useful for round-trip verification.
 *
 * // Why this routes through `backend.native` instead of cypher: the
 * // Neo4j-flavored implementation used `OPTIONAL MATCH … WITH …
 * // count(DISTINCT)`, which sits squarely in qengine territory and
 * // would push PolyGraph's regex bridge past v0.1.4. Per
 * // BUILD-PHASE-1E-PLAN.md §1e.3 we keep cypher pressure off the
 * // bridge by switching to native primitives (`findNodes` +
 * // `findRelationships`). Both backends implement `native.*` so the
 * // shape is the same.
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
  // Why the unknown cast: the verify-side option type intentionally
  // disallows `namespace` (the contractId+namespace pair is passed as
  // positional args, not in options). Internally we share
  // `toBackendOptions` which doesn't read `namespace` anyway.
  const backend = await selectBackend(
    toBackendOptions(options as unknown as CommitOptions),
  );
  try {
    // hasAnchor: is there a HAS_CONTRACT rel pointing to a Contract
    // with matching contractId AND matching namespace?
    const hasContractRels = await backend.native.findRelationships('HAS_CONTRACT', {});
    // We need to know whether one of those edges lands on a Contract
    // node tagged with this contractId+namespace AND originates from a
    // Solution tagged with this namespace. Fetch the candidate Contract
    // node first.
    const contractCandidates = await backend.native.findNodes('Contract', {
      contractId,
      namespace,
    });
    let hasAnchor = false;
    if (contractCandidates.length > 0) {
      const contractIds = new Set(contractCandidates.map((c) => c.id));
      // Check at least one HAS_CONTRACT rel ends on one of these
      // candidate contracts and starts on a Solution with the same
      // namespace.
      const solutionNodes = await backend.native.findNodes('Solution', { namespace });
      const solutionIds = new Set(solutionNodes.map((s) => s.id));
      hasAnchor = hasContractRels.some(
        (r) => solutionIds.has(r.startNode) && contractIds.has(r.endNode),
      );
    }

    // nodeCount: nodes tagged {contractId, namespace}. The committer
    // tags every Contract sub-node and the Contract envelope itself,
    // so this counts everything.
    //
    // // Why we iterate labels rather than a label-less findNodes:
    // // PolyGraph's `findNodes(label)` is label-indexed; a label-less
    // // scan would require `allNodes()` which is O(graph) and would
    // // pull non-contract nodes into memory. Iterating the known
    // // labels is bounded by the schema.
    const subNodeLabels = [
      'Contract',
      'Principle',
      'Constraint',
      'Service',
      'Process',
      'DataObject',
      'Hypothesis',
    ];
    const seenNodeIds = new Set<string>();
    for (const label of subNodeLabels) {
      const nodes = await backend.native.findNodes(label, { contractId, namespace });
      for (const n of nodes) seenNodeIds.add(n.id);
    }
    const nodeCount = seenNodeIds.size;

    // edgeCount: outgoing relationships from nodes tagged
    // {contractId, namespace}. The committer creates DECLARES_*
    // edges from the Contract envelope to each sub-node, plus
    // COMPOSES edges to peers. We count rels whose start node is one
    // of our seen ids.
    //
    // // Why types are enumerated: PolyGraph's `findRelationships` is
    // // type-indexed; a type-less scan would require walking every
    // // relationship in the graph. Listing the known types we write
    // // keeps the scan bounded.
    const declaresTypes = [
      'DECLARES_PRINCIPLE',
      'DECLARES_CONSTRAINT',
      'DECLARES_SERVICE',
      'DECLARES_PROCESS',
      'DECLARES_DATAOBJECT',
      'DECLARES_HYPOTHESIS',
      'COMPOSES',
    ];
    const seenRelIds = new Set<string>();
    for (const type of declaresTypes) {
      const rels = await backend.native.findRelationships(type, {});
      for (const r of rels) {
        if (seenNodeIds.has(r.startNode)) {
          seenRelIds.add(r.id);
        }
      }
    }
    const edgeCount = seenRelIds.size;

    return { contractId, nodeCount, edgeCount, hasAnchor };
  } finally {
    await backend.close();
  }
}
