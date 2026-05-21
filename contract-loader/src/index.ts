/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md.
 *
 *   Ownership: asi-local.
 */

/**
 * Public surface for `@asi/contract-loader`.
 *
 * @module index
 */

export type {
  BookendFrontMatter,
  Constraint,
  Contract,
  ContractGraph,
  DataObject,
  Hypothesis,
  AcceptanceCriterion,
  Principle,
  Process,
  Service,
} from './types.js';

export { parseBookend } from './parse-bookend.js';
export {
  commitContract,
  verifyContract,
  type CommitOptions,
  type CommitSummary,
} from './commit-contract.js';
export {
  listContracts,
  showContract,
  type ContractsConnection,
  type ContractListEntry,
  type ContractDetail,
} from './query-contracts.js';
