/**
 * Derived from archetypes/solution-intel/reference-impl/graph-client/src/index.ts
 * Source archetype: solution-intel
 * Source commit: solution-intel-reference-impl-2026-05-21
 * Adoption: archetypes-solution-intelligence (asi profile)
 * Adopted at: 2026-05-21
 * Modifications:
 *   - Package scope rename: @solution-intelligence/graph-client → @asi/graph-client
 *   - @adopt:composes:graph ANSWERED → graph-db (default kept; the
 *     concrete backing store for the asi SIG is PolyGraph/Neo4j at
 *     bolt://localhost:7689 — see scripts/seed-solution.ts)
 *   - @adopt:graph-endpoint ANSWERED → bolt://localhost:7689 (the
 *     constellation PolyGraph instance; auth neo4j / udt-pass-2026)
 */

/**
 * Public library exports for `@asi/graph-client`.
 *
 * // Why: Stage 2c stands up the package scaffold — the build, test, lint,
 * // and CI pipelines — without committing to a particular shape for the
 * // graph client yet. Stage 3 fills this file in with a typed
 * // `SIGraphClient` (modeled on `SIIdentityClient` in the cli package),
 * // a shared `SIHttpError`, and response types for the graph endpoints
 * // (CRUD on nodes and edges, traversal queries, audit-block linkage).
 * //
 * // Why an empty re-export now: keeping the entrypoint file present and
 * // wired through tsup / vitest means the CI pipeline exercises the full
 * // build-and-test loop end to end. When Stage 3 lands the
 * // implementation, the only thing that changes here is the body — the
 * // surrounding tooling has already been proven green.
 *
 * @module index
 */

// @adopt:composes:graph
// Q: Which graph-substrate archetype does this project compose?
// Default: graph-db via PolyGraph (the SI/G server hosts the project's
//          Solution Intelligence Graph; the graph-client package is the
//          typed HTTP client that talks to it). Stage 3 lands the
//          implementation.
// ANSWER:  graph-db via PolyGraph/Neo4j (default kept). Concrete
//          deployment: the constellation-neo4j container exposing Bolt
//          on port 7689. The Solution root is seeded by
//          scripts/seed-solution.ts as `(s:Solution {namespace: 'asi',
//          name: 'Archetypes'})`. The typed HTTP client body is still
//          a scaffold here; Stage 3 of upstream will land it, and a
//          refresh of this adoption will pull it in.
// Reference: archetypes/graph-db/ARCHETYPE.md (pending)
// Notes: This package IS the graph composition site for the SI substrate.
//        Replacing the graph archetype (Neo4j-via-Bolt, Neptune, in-memory
//        for tests) means replacing this client's wire format and
//        endpoint surface. The Stage-3 implementation will pick that
//        wire format; until then this is a placeholder.
// Alternatives: any archetype whose contract satisfies the graph role.
//               Currently registered: graph-db (pending Stage 3 lift).

// @adopt:graph-endpoint
// Q: What URL does the graph client target by default?
//    Stage 3 will read this from .asi/config.yaml's `si.graphUrl` (see
//    cli/src/url.ts's resolveProjectConfig). Until then, no default
//    endpoint is hard-coded — the scaffold is intentionally empty.
// Default: (none; supplied at construction time by the consuming process)
// ANSWER:  bolt://localhost:7689 (Neo4j Bolt protocol; the
//          constellation PolyGraph instance). When Stage 3 implements
//          the client body, .asi/config.yaml should carry:
//            si:
//              graphUrl: bolt://localhost:7689
// Format: absolute URL

export {};
