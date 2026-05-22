/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-1E-PLAN.md §1e.1.
 *
 *   Ownership: asi-local. The single entry point that callers of
 *   commit-contract.ts / query-contracts.ts go through to obtain a
 *   `Backend`.
 */

/**
 * Backend selection.
 *
 * // Why a separate file from types.ts: the resolver in `types.ts` is
 * // pure (just option-shape inspection); `selectBackend()` here is
 * // impure (constructs a live driver or opens a leveldb). Splitting
 * // keeps the pure types importable without dragging in heavy
 * // dependencies (neo4j-driver, polygraph-db).
 *
 * @module backends/select
 */

import { resolveBackendKind, type Backend, type BackendOptions } from './types.js';
import { Neo4jBackend } from './neo4j-backend.js';
import { PolyGraphBackend } from './polygraph-backend.js';

/**
 * Constructs and returns a ready-to-use {@link Backend} from the
 * supplied option object.
 *
 * Precedence rules: see {@link resolveBackendKind}.
 *
 * Caller owns the returned backend's lifecycle and MUST `await
 * backend.close()` when finished. The exception is the Neo4j path when
 * the caller passed in their own `driver` — in that case the backend's
 * `close()` is a no-op and the caller continues to own the driver.
 */
export async function selectBackend(options: BackendOptions): Promise<Backend> {
  const kind = resolveBackendKind(options);
  switch (kind) {
    case 'neo4j':
      return Neo4jBackend.open(options);
    case 'polygraph':
      return PolyGraphBackend.open(options);
  }
}
