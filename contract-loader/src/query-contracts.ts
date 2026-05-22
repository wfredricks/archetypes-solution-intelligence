/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase E (CLI integration).
 *
 *   Refactored 2026-05-22 under BUILD-PHASE-1E-PLAN.md §1e.2 to route
 *   all reads through the new {@link Backend} interface. Public
 *   function signatures of `listContracts` and `showContract` are
 *   unchanged from Phase 1c.
 *
 *   Ownership: asi-local.
 */

/**
 * Read-side helpers for the `asi contracts list` and `asi contracts show`
 * subcommands.
 *
 * // Why: The CLI does not parse markdown; it queries the graph for
 * // contracts the loader has already committed. Keeping the read helpers
 * // beside the writer (commit-contract.ts) means the Cypher shape stays
 * // consistent — anything we write here, we read with the same labels
 * // and properties.
 *
 * @module query-contracts
 */

import type { Driver } from 'neo4j-driver';

import type { BackendOptions } from './backends/types.js';
import { selectBackend } from './backends/select.js';

export interface ContractsConnection {
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  driver?: Driver;
  /**
   * Explicit backend selector. See `backends/types.ts` for the
   * precedence rules; default is Neo4j to preserve Phase 1c behavior.
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

export interface ContractListEntry {
  archetypeName: string;
  archetypeKind: string;
  archetypeVersion: string;
  contractId: string;
}

export interface ContractDetail extends ContractListEntry {
  sourceBookend: string;
  principles: { key: string; name: string; driver: string }[];
  constraints: { key: string; name: string; rationale: string }[];
  services: { key: string; name: string; description: string }[];
  processes: { key: string; name: string; cadence: string }[];
  dataObjects: { key: string; name: string; description: string }[];
  hypotheses: { key: string; text: string; status: string; verifiedAt: string | null }[];
  composes: string[];
}

function toBackendOptions(options: ContractsConnection): BackendOptions {
  return {
    backend: options.backend,
    graphUrl: options.graphUrl,
    graphUser: options.graphUser,
    graphPass: options.graphPass,
    driver: options.driver,
    polygraphPath: options.polygraphPath,
  };
}

/**
 * Lists all contracts anchored to the given namespace's Solution root.
 */
export async function listContracts(
  namespace: string,
  options: ContractsConnection = {},
): Promise<ContractListEntry[]> {
  const backend = await selectBackend(toBackendOptions(options));
  try {
    const rows = await backend.query(
      `MATCH (s:Solution {namespace: $namespace})-[:HAS_CONTRACT]->(c:Contract)
       RETURN c.archetypeName AS archetypeName,
              c.archetypeKind AS archetypeKind,
              c.archetypeVersion AS archetypeVersion,
              c.contractId AS contractId
       ORDER BY c.archetypeName`,
      { namespace },
    );
    return rows.map((r) => ({
      archetypeName: r.archetypeName as string,
      archetypeKind: r.archetypeKind as string,
      archetypeVersion: r.archetypeVersion as string,
      contractId: r.contractId as string,
    }));
  } finally {
    await backend.close();
  }
}

/**
 * Fetches a single contract by archetype name (within the namespace) and
 * returns its full structured detail. Returns null if not found.
 */
export async function showContract(
  archetypeName: string,
  namespace: string,
  options: ContractsConnection = {},
): Promise<ContractDetail | null> {
  const backend = await selectBackend(toBackendOptions(options));
  try {
    const envelope = await backend.query(
      `MATCH (s:Solution {namespace: $namespace})-[:HAS_CONTRACT]->(c:Contract {archetypeName: $archetypeName, namespace: $namespace})
       RETURN c.archetypeName AS archetypeName,
              c.archetypeKind AS archetypeKind,
              c.archetypeVersion AS archetypeVersion,
              c.contractId AS contractId,
              c.sourceBookend AS sourceBookend`,
      { namespace, archetypeName },
    );
    if (envelope.length === 0) return null;
    const e = envelope[0];
    const contractId = e.contractId as string;

    // Why: All sub-node queries scope by BOTH contractId AND namespace.
    // contractIds collide deterministically across namespaces (e.g.
    // the same events-spine bookend loaded into asi and asi-test-*
    // produces identical contractIds). Without the namespace filter,
    // sub-node counts double across namespaces.
    const principles = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_PRINCIPLE]->(p:Principle)
       RETURN p.key AS key, p.name AS name, p.driver AS driver
       ORDER BY p.key`,
      { contractId, namespace },
    );
    const constraints = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_CONSTRAINT]->(n:Constraint)
       RETURN n.key AS key, n.name AS name, n.rationale AS rationale
       ORDER BY n.key`,
      { contractId, namespace },
    );
    const services = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_SERVICE]->(n:Service)
       RETURN n.key AS key, n.name AS name, n.description AS description
       ORDER BY n.key`,
      { contractId, namespace },
    );
    const processes = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_PROCESS]->(n:Process)
       RETURN n.key AS key, n.name AS name, n.cadence AS cadence
       ORDER BY n.key`,
      { contractId, namespace },
    );
    const dataObjects = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_DATAOBJECT]->(n:DataObject)
       RETURN n.key AS key, n.name AS name, n.description AS description
       ORDER BY n.key`,
      { contractId, namespace },
    );
    const hypotheses = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_HYPOTHESIS]->(n:Hypothesis)
       RETURN n.key AS key, n.text AS text, n.status AS status, n.verifiedAt AS verifiedAt
       ORDER BY n.key`,
      { contractId, namespace },
    );
    const composes = await backend.query(
      `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:COMPOSES]->(child:Contract)
       RETURN child.archetypeName AS name
       ORDER BY child.archetypeName`,
      { contractId, namespace },
    );

    return {
      archetypeName: e.archetypeName as string,
      archetypeKind: e.archetypeKind as string,
      archetypeVersion: e.archetypeVersion as string,
      contractId,
      sourceBookend: e.sourceBookend as string,
      principles: principles.map((r) => ({
        key: r.key as string,
        name: r.name as string,
        driver: r.driver as string,
      })),
      constraints: constraints.map((r) => ({
        key: r.key as string,
        name: r.name as string,
        rationale: r.rationale as string,
      })),
      services: services.map((r) => ({
        key: r.key as string,
        name: r.name as string,
        description: r.description as string,
      })),
      processes: processes.map((r) => ({
        key: r.key as string,
        name: r.name as string,
        cadence: r.cadence as string,
      })),
      dataObjects: dataObjects.map((r) => ({
        key: r.key as string,
        name: r.name as string,
        description: r.description as string,
      })),
      hypotheses: hypotheses.map((r) => ({
        key: r.key as string,
        text: r.text as string,
        status: r.status as string,
        // Why: Neo4j returns `null` for unset properties; older
        // Hypothesis nodes pre-dating the verifiedAt addition surface
        // as null and render without a `verified=` suffix in the CLI.
        verifiedAt: (r.verifiedAt as string | null) ?? null,
      })),
      composes: composes.map((r) => r.name as string),
    };
  } finally {
    await backend.close();
  }
}
