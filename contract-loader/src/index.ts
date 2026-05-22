/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md.
 *
 *   Extended 2026-05-22 under BUILD-PHASE-1E-PLAN.md to export the
 *   backend interface so adopters can construct backends out-of-band
 *   (e.g. when sharing one PolyGraph instance across many contract
 *   commits).
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

// Backend interface — exported for adopters who want to share a single
// backend instance across many commits/queries (avoids opening leveldb
// per call when using PolyGraph). Phase 1e addition.
export type { Backend, BackendOptions } from './backends/types.js';
export { resolveBackendKind } from './backends/types.js';
export { selectBackend } from './backends/select.js';
