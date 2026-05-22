/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md. No upstream archetype source —
 *   this file realizes the ArchiMate-flavored SIG ontology extensions
 *   proposed in
 *   `~/.openclaw/workspace/memory/backlog-sig-archimate-ontology-2026-05-21.md`
 *   and committed to in `archetypes/events-spine/LEFT-BOOKEND.md`.
 *
 *   Ownership: asi-local (until or unless this ontology graduates to its
 *   own archetype, at which point this file gets a real provenance header
 *   and the types become archetype-owned per METHODOLOGY.md §Reference
 *   language).
 */

/**
 * In-memory shape of an archetype contract before it is committed to
 * PolyGraph.
 *
 * // Why: The parser produces this; the committer consumes it. Splitting
 * // parse from commit lets us round-trip-test the parser without a
 * // running Neo4j, and lets us swap commit targets later (e.g. a
 * // test-only namespace) without touching the parser.
 *
 * @module types
 */

/**
 * The contract envelope. One per archetype.
 *
 * archetypeName / archetypeKind / archetypeVersion are read from the
 * LEFT-BOOKEND.md's YAML front-matter when present, or inferred from the
 * file path otherwise. sourceBookend is the absolute path the loader read.
 * contractId is a deterministic key used for idempotent re-loading.
 */
export interface Contract {
  archetypeName: string;
  archetypeKind: 'composite' | 'primitive' | 'meta-pattern';
  archetypeVersion: string;
  sourceBookend: string;
  contractId: string;
}

/** ArchiMate Principle: a normative posture this archetype commits to. */
export interface Principle {
  key: string;
  name: string;
  driver: string;
  consequences: string[];
  alternativeConsidered: string;
}

/** ArchiMate Constraint: a restriction limiting realization. */
export interface Constraint {
  key: string;
  name: string;
  rationale: string;
}

/** ArchiMate Service: an externally-visible contract surface. */
export interface Service {
  key: string;
  name: string;
  signature: string;
  description: string;
}

/** ArchiMate Process: a workflow with trigger and cadence. */
export interface Process {
  key: string;
  name: string;
  trigger: string;
  cadence: string;
  description: string;
}

/** ArchiMate DataObject: a canonical data shape (Passive Structure). */
export interface DataObject {
  key: string;
  name: string;
  description: string;
  schemaHint: string;
}

/** Bookend-specific concept: a hypothesis the right bookend will test. */
export interface Hypothesis {
  key: string;
  text: string;
  status: 'open' | 'held' | 'partial' | 'violated';
  /**
   * ISO-8601 timestamp recording when this hypothesis last had its
   * status updated by writeback. `null` for parsed-from-bookend
   * hypotheses (by definition `open` and unverified). Populated by
   * scripts that write back hypothesis status to the SIG (e.g.
   * `writeback-events-spine-hypotheses.ts`) and round-tripped through
   * commit + query.
   *
   * // Why: operators inspecting `asi contracts show` need to know not
   * // just THAT a hypothesis is held, but WHEN that determination was
   * // last made. Without verifiedAt, a stale `held` is
   * // indistinguishable from a fresh one.
   */
  verifiedAt?: string | null;
}

/** Acceptance criterion: a verifiable assertion. */
export interface AcceptanceCriterion {
  key: string;
  text: string;
  status: 'open' | 'met' | 'unmet';
}

/**
 * The full in-memory contract graph: one Contract envelope plus all its
 * sub-nodes.
 *
 * `composes` is the list of child archetype names the composite contract
 * declares; the committer translates these into pending `COMPOSES` edges
 * (which resolve only when the child Contract nodes exist).
 */
export interface ContractGraph {
  contract: Contract;
  principles: Principle[];
  constraints: Constraint[];
  services: Service[];
  processes: Process[];
  dataObjects: DataObject[];
  hypotheses: Hypothesis[];
  acceptanceCriteria: AcceptanceCriterion[];
  composes: string[];
}

/**
 * Optional YAML front-matter shape on a LEFT-BOOKEND.md. When present,
 * these values override the parser's inferences.
 *
 * // Why: METHODOLOGY.md flagged that LEFT-BOOKEND files vary in their
 * // section numbering and that future contracts should follow a stable
 * // shape. The minimum stable contract identity is three fields; we add
 * // them as front-matter rather than asking the parser to reconstruct
 * // identity from the file name + section headers.
 */
export interface BookendFrontMatter {
  archetypeName?: string;
  archetypeKind?: 'composite' | 'primitive' | 'meta-pattern';
  archetypeVersion?: string;
}
