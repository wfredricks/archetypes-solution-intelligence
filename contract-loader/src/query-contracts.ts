/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase E (CLI integration).
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
import neo4j from 'neo4j-driver';

const DEFAULT_GRAPH_URL = 'bolt://localhost:7689';
const DEFAULT_GRAPH_USER = 'neo4j';
const DEFAULT_GRAPH_PASS = 'udt-pass-2026';

export interface ContractsConnection {
  graphUrl?: string;
  graphUser?: string;
  graphPass?: string;
  driver?: Driver;
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

/**
 * Lists all contracts anchored to the given namespace's Solution root.
 */
export async function listContracts(
  namespace: string,
  options: ContractsConnection = {},
): Promise<ContractListEntry[]> {
  const ownsDriver = options.driver === undefined;
  const driver = options.driver ?? makeDriver(options);
  try {
    const session = driver.session();
    try {
      const res = await session.run(
        `MATCH (s:Solution {namespace: $namespace})-[:HAS_CONTRACT]->(c:Contract)
         RETURN c.archetypeName AS archetypeName,
                c.archetypeKind AS archetypeKind,
                c.archetypeVersion AS archetypeVersion,
                c.contractId AS contractId
         ORDER BY c.archetypeName`,
        { namespace },
      );
      return res.records.map((r) => ({
        archetypeName: r.get('archetypeName'),
        archetypeKind: r.get('archetypeKind'),
        archetypeVersion: r.get('archetypeVersion'),
        contractId: r.get('contractId'),
      }));
    } finally {
      await session.close();
    }
  } finally {
    if (ownsDriver) await driver.close();
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
  const ownsDriver = options.driver === undefined;
  const driver = options.driver ?? makeDriver(options);
  try {
    const session = driver.session();
    try {
      const envelope = await session.run(
        `MATCH (s:Solution {namespace: $namespace})-[:HAS_CONTRACT]->(c:Contract {archetypeName: $archetypeName, namespace: $namespace})
         RETURN c.archetypeName AS archetypeName,
                c.archetypeKind AS archetypeKind,
                c.archetypeVersion AS archetypeVersion,
                c.contractId AS contractId,
                c.sourceBookend AS sourceBookend`,
        { namespace, archetypeName },
      );
      if (envelope.records.length === 0) return null;
      const e = envelope.records[0];
      const contractId = e.get('contractId') as string;

      // Why: All sub-node queries scope by BOTH contractId AND namespace.
      // contractIds collide deterministically across namespaces (e.g.
      // the same events-spine bookend loaded into asi and asi-test-*
      // produces identical contractIds). Without the namespace filter,
      // sub-node counts double across namespaces.
      const principles = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_PRINCIPLE]->(p:Principle)
         RETURN p.key AS key, p.name AS name, p.driver AS driver
         ORDER BY p.key`,
        { contractId, namespace },
      );
      const constraints = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_CONSTRAINT]->(n:Constraint)
         RETURN n.key AS key, n.name AS name, n.rationale AS rationale
         ORDER BY n.key`,
        { contractId, namespace },
      );
      const services = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_SERVICE]->(n:Service)
         RETURN n.key AS key, n.name AS name, n.description AS description
         ORDER BY n.key`,
        { contractId, namespace },
      );
      const processes = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_PROCESS]->(n:Process)
         RETURN n.key AS key, n.name AS name, n.cadence AS cadence
         ORDER BY n.key`,
        { contractId, namespace },
      );
      const dataObjects = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_DATAOBJECT]->(n:DataObject)
         RETURN n.key AS key, n.name AS name, n.description AS description
         ORDER BY n.key`,
        { contractId, namespace },
      );
      const hypotheses = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:DECLARES_HYPOTHESIS]->(n:Hypothesis)
         RETURN n.key AS key, n.text AS text, n.status AS status, n.verifiedAt AS verifiedAt
         ORDER BY n.key`,
        { contractId, namespace },
      );
      const composes = await session.run(
        `MATCH (c:Contract {contractId: $contractId, namespace: $namespace})-[:COMPOSES]->(child:Contract)
         RETURN child.archetypeName AS name
         ORDER BY child.archetypeName`,
        { contractId, namespace },
      );

      return {
        archetypeName: e.get('archetypeName'),
        archetypeKind: e.get('archetypeKind'),
        archetypeVersion: e.get('archetypeVersion'),
        contractId,
        sourceBookend: e.get('sourceBookend'),
        principles: principles.records.map((r) => ({
          key: r.get('key'),
          name: r.get('name'),
          driver: r.get('driver'),
        })),
        constraints: constraints.records.map((r) => ({
          key: r.get('key'),
          name: r.get('name'),
          rationale: r.get('rationale'),
        })),
        services: services.records.map((r) => ({
          key: r.get('key'),
          name: r.get('name'),
          description: r.get('description'),
        })),
        processes: processes.records.map((r) => ({
          key: r.get('key'),
          name: r.get('name'),
          cadence: r.get('cadence'),
        })),
        dataObjects: dataObjects.records.map((r) => ({
          key: r.get('key'),
          name: r.get('name'),
          description: r.get('description'),
        })),
        hypotheses: hypotheses.records.map((r) => ({
          key: r.get('key'),
          text: r.get('text'),
          status: r.get('status'),
          // Why: Neo4j returns `null` for unset properties; older
          // Hypothesis nodes pre-dating the verifiedAt addition surface
          // as null and render without a `verified=` suffix in the CLI.
          verifiedAt: r.get('verifiedAt') ?? null,
        })),
        composes: composes.records.map((r) => r.get('name') as string),
      };
    } finally {
      await session.close();
    }
  } finally {
    if (ownsDriver) await driver.close();
  }
}

function makeDriver(options: ContractsConnection): Driver {
  return neo4j.driver(
    options.graphUrl ?? DEFAULT_GRAPH_URL,
    neo4j.auth.basic(
      options.graphUser ?? DEFAULT_GRAPH_USER,
      options.graphPass ?? DEFAULT_GRAPH_PASS,
    ),
  );
}
