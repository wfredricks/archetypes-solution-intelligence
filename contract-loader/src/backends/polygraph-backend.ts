/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-1E-PLAN.md §1e.3.
 *
 *   Ownership: asi-local. Implements the `Backend` interface against
 *   `polygraph-db@0.1.4` (LevelAdapter), bridging the cypher patterns
 *   contract-loader uses today onto PolyGraph's regex bridge, with a
 *   native fallback for the verify path (qengine-territory).
 */

/**
 * PolyGraph implementation of {@link Backend}.
 *
 * ## Why a separate backend
 *
 * contract-loader was hard-coupled to Neo4j through Phase 1c. Phase 1d
 * grew the PolyGraph cypher bridge to cover everything contract-loader
 * needs *except* the verify path (`OPTIONAL MATCH … WITH … count(DISTINCT)`).
 * Phase 1e bridges that gap on the consumer side by routing the verify
 * path through native PolyGraph APIs (`findNodes` + `findRelationships`)
 * instead of pushing the bridge to grow `WITH`/`count`/`DISTINCT`.
 *
 * ## Two bridge limitations the adapter compensates for
 *
 * 1. **No `$param` binding** — the bridge inlines literal values. The
 *    adapter substitutes `$paramName` against the supplied `params`
 *    object before calling `engine.query()`. Strings are JSON-encoded
 *    (which handles backslash and double-quote escaping correctly);
 *    numbers and booleans are stringified directly; `null` becomes the
 *    literal `null`. Composite values would require richer handling
 *    but contract-loader passes only primitives.
 *
 * 2. **No aggregation in RETURN** — `RETURN count(child) AS linked`
 *    is unsupported by the bridge. The adapter falls back to native:
 *    when it sees a `RETURN count(...)` pattern it strips the
 *    aggregation, runs the MATCH portion to get the rows, and
 *    aggregates in JavaScript before returning a single row in the
 *    same shape Neo4j would.
 *
 * ## `ORDER BY` handling
 *
 * The bridge silently accepts but does not execute `ORDER BY`. The
 * adapter therefore sorts results in JavaScript when an `ORDER BY`
 * clause is present in the supplied cypher. This keeps the cross-
 * backend behavior identical for `listContracts` and `showContract`,
 * which both depend on stable key ordering.
 *
 * @module backends/polygraph-backend
 */

import { LevelAdapter, PolyGraph } from 'polygraph-db';

import type { Backend, BackendOptions } from './types.js';

export class PolyGraphBackend implements Backend {
  readonly kind = 'polygraph' as const;

  private constructor(private readonly graph: PolyGraph) {}

  /**
   * Constructs a PolyGraph backend from the option object.
   *
   * Requires `options.polygraphPath` — the leveldb directory. Each
   * call opens a fresh graph instance; callers MUST `close()` when
   * done to release the leveldb lock.
   */
  static async open(options: BackendOptions): Promise<PolyGraphBackend> {
    const path = options.polygraphPath;
    if (!path) {
      throw new Error(
        'polygraph backend requires options.polygraphPath (a leveldb directory)',
      );
    }
    const adapter = new LevelAdapter({ path });
    const graph = new PolyGraph({ adapter });
    await graph.open();
    return new PolyGraphBackend(graph);
  }

  /**
   * Execute a cypher query through the PolyGraph regex bridge with
   * three adapter-side compensations the bridge does not handle
   * natively as of v0.1.4:
   *
   *   1. `$param` substitution from the supplied `params` object.
   *   2. Aggregation fallback for `RETURN count(...) AS alias`.
   *   3. JavaScript `ORDER BY` post-sort.
   *
   * In addition the writer patterns contract-loader emits (CREATE
   * with property literals; MATCH+CREATE+CREATE; multi-statement
   * MATCH+MATCH+MERGE) are routed to native primitives, because the
   * bridge's `parseInlineProps` does a naive comma-split and its
   * `parseValue` is a string-slice rather than `JSON.parse`. A
   * Principle whose driver text is `"… (small constellations, ≤1000
   * events/sec)."` would otherwise land with its `name` truncated at
   * the first comma and embedded `"` characters preserved verbatim.
   *
   * The set of patterns recognized below is exactly what
   * commit-contract.ts and query-contracts.ts emit — not a general
   * cypher router. If commit-contract.ts grows a new shape, this
   * dispatcher needs a new arm.
   *
   * // Why route on the adapter side instead of asking the bridge to
   * // grow: per BUILD-PHASE-1E-PLAN.md §"Hard constraints" #3, the
   * // polygraph bridge stays at v0.1.4 for this phase. The plan
   * // recommendation in §1e.3 was "use native PolyGraph API in the
   * // adapter" — for `verifyContract` specifically, but the same
   * // discipline applies whenever the bridge's regex limits would
   * // mangle a write.
   */
  async query(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<Array<Record<string, unknown>>> {
    const inlined = inlineParams(cypher, params);

    // Write-path short-circuits. Order matters: the most specific
    // patterns are matched first.

    // Pattern A: idempotent wipe.
    //   `MATCH (n {contractId: "...", namespace: "..."}) DETACH DELETE n`
    if (/^\s*MATCH\s+\([A-Za-z_]\w*\s*\{[^}]*\}\s*\)\s+DETACH\s+DELETE\s+\w+\s*$/i.test(inlined)) {
      return this.executeWipe(params);
    }

    // Pattern B: `CREATE (c:Contract { … })` envelope create.
    if (/^\s*CREATE\s+\([A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*\{[\s\S]*\}\s*\)\s*$/i.test(inlined)) {
      return this.executeCreateNode(cypher, params);
    }

    // Pattern C: `MATCH (parent: ...) CREATE (child:Label { ... }) CREATE (parent)-[:REL]->(child)`
    //   Used by every sub-node create in commit-contract.ts.
    if (
      /^\s*MATCH\s+\([A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*\{[^}]*\}\s*\)[\s\S]+CREATE\s+\([A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*\{[\s\S]*\}\s*\)[\s\S]+CREATE\s+\([A-Za-z_]\w*\)-\[:[A-Za-z_]\w*\]->\([A-Za-z_]\w*\)\s*$/i.test(
        inlined,
      )
    ) {
      return this.executeMatchCreateCreate(cypher, params);
    }

    // Pattern D: Anchor MERGE.
    //   `MATCH (s:Solution {namespace}) MATCH (c:Contract {contractId, namespace})
    //    MERGE (s)-[:HAS_CONTRACT]->(c) RETURN s.name AS solutionName`
    if (/MERGE\s+\([A-Za-z_]\w*\)-\[:[A-Za-z_]\w*\]->\([A-Za-z_]\w*\)/i.test(inlined)) {
      return this.executeAnchorMerge(cypher, params);
    }

    // Read path: send through the bridge with parameter substitution.

    // Aggregation fallback: `RETURN count(<var>) AS <alias>` is
    // qengine territory. Strip the aggregation, run the rest, count
    // rows in JS, return a single row.
    const aggMatch = /\bRETURN\s+count\s*\(\s*([A-Za-z_]\w*)\s*\)\s+AS\s+([A-Za-z_]\w*)\s*$/i.exec(
      inlined.trim(),
    );
    if (aggMatch) {
      const [full, , alias] = aggMatch;
      const withoutReturn = inlined.trim().slice(0, inlined.trim().length - full.length).trim();
      // The MATCH body still needs SOMETHING to return so the bridge
      // emits one row per match. Append a trivial `RETURN 1 AS _x`.
      const probe = `${withoutReturn} RETURN 1 AS _x`;
      const rows = await this.graph.query(probe);
      return [{ [alias]: rows.length }];
    }

    // ORDER BY handling: detect and strip before sending to the
    // bridge (bridge silently accepts but does not execute it); sort
    // in JS afterwards.
    const orderByMatch = /\bORDER\s+BY\s+(.+?)\s*$/i.exec(inlined);
    let queryToRun = inlined;
    let postSort: ((rows: Array<Record<string, unknown>>) => void) | null = null;
    if (orderByMatch) {
      const orderByExpr = orderByMatch[1].trim();
      queryToRun = inlined.slice(0, orderByMatch.index).trim();
      postSort = (rows) => sortRowsByExpression(rows, orderByExpr);
    }

    const raw = (await this.graph.query(queryToRun)) as Array<Record<string, unknown>>;

    // PolyGraph's `formatResults` returns `{ <alias>: <primitive-or-node> }`
    // for explicit aliases (every read query in contract-loader uses
    // explicit aliases). Surface the rows untouched after the optional sort.
    const rows: Array<Record<string, unknown>> = raw.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v;
      }
      return out;
    });

    if (postSort) postSort(rows);
    return rows;
  }

  /**
   * Pattern A: idempotent wipe.
   *   `MATCH (n {contractId: $contractId, namespace: $namespace}) DETACH DELETE n`
   *
   * Native path: scan every label we know contract-loader writes,
   * find the nodes matching the inline filter, delete each. Same
   * behavioral semantics as the bridge would have (which works for
   * the wipe pattern — the bridge's `executeMatch` label-less branch
   * walks `allNodes()`), but bounded to the label set so we don't
   * pull non-contract nodes into memory.
   */
  private async executeWipe(
    params: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const filter = simpleFilterToPolyGraph({
      contractId: params.contractId,
      namespace: params.namespace,
    });
    const labels = [
      'Contract',
      'Principle',
      'Constraint',
      'Service',
      'Process',
      'DataObject',
      'Hypothesis',
    ];
    for (const label of labels) {
      const nodes = await this.graph.findNodes(label, filter);
      for (const n of nodes) {
        await this.graph.deleteNode(n.id);
      }
    }
    return [];
  }

  /**
   * Pattern B: bare `CREATE (var:Label { ...properties... })`.
   *
   * Used by the Contract envelope create in step 2 of doCommit. The
   * cypher does NOT contain backend-incompatible syntax — it's the
   * property literals that the bridge mangles. Bypass the parser by
   * reading properties from `params` directly: every property key
   * the bookend writes already exists in `params` as a `$paramName`,
   * and the cypher template names them with the same key.
   *
   * // Why this isn't fragile: commit-contract.ts is the only writer
   * // and we own that file. Any time a new property is added there,
   * // a new entry lands in `params` with the same name and the
   * // mapping stays one-to-one.
   */
  private async executeCreateNode(
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const m = /^\s*CREATE\s+\([A-Za-z_]\w*\s*:\s*([A-Za-z_]\w*)\s*\{([\s\S]*)\}\s*\)\s*$/i.exec(cypher);
    if (!m) throw new Error(`PolyGraphBackend.executeCreateNode: unrecognized pattern: ${cypher}`);
    const label = m[1];
    const propsText = m[2];
    const properties = extractPropertiesFromTemplate(propsText, params);
    await this.graph.createNode([label], properties);
    return [];
  }

  /**
   * Pattern C: MATCH-then-CREATE-child-then-CREATE-edge.
   *
   * Pseudo:
   *   MATCH (parent:ParentLabel { contractId: $cid, namespace: $ns })
   *   CREATE (child:ChildLabel { …properties… })
   *   CREATE (parent)-[:DECLARES_X]->(child)
   *
   * Native path: find the parent via `findNodes`, create the child
   * via `createNode`, attach via `createRelationship`. If the parent
   * doesn't exist we return an empty result (same shape Neo4j would
   * deliver — MATCH-then-fail produces zero rows; the downstream
   * CREATEs simply don't run).
   */
  private async executeMatchCreateCreate(
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    // Pull the parent label + inline filter.
    const matchPart = /MATCH\s+\([A-Za-z_]\w*\s*:\s*([A-Za-z_]\w*)\s*\{([^}]*)\}\s*\)/i.exec(cypher);
    if (!matchPart) throw new Error(`PolyGraphBackend.executeMatchCreateCreate: no MATCH parent: ${cypher}`);
    const parentLabel = matchPart[1];
    const parentFilter = extractPropertiesFromTemplate(matchPart[2], params);
    const parents = await this.graph.findNodes(
      parentLabel,
      simpleFilterToPolyGraph(parentFilter),
    );
    if (parents.length === 0) return [];
    const parent = parents[0];

    // Pull the child label + properties (FIRST CREATE after the MATCH).
    // The CREATE regex must scan past the MATCH; we anchor on the
    // last `CREATE (...:Label { ... })` BEFORE the relationship CREATE.
    // commit-contract.ts always emits exactly one such CREATE before
    // the relationship CREATE.
    const childCreate = /CREATE\s+\([A-Za-z_]\w*\s*:\s*([A-Za-z_]\w*)\s*\{([\s\S]*?)\}\s*\)/i.exec(
      cypher.substring(matchPart.index + matchPart[0].length),
    );
    if (!childCreate) throw new Error(`PolyGraphBackend.executeMatchCreateCreate: no child CREATE: ${cypher}`);
    const childLabel = childCreate[1];
    const childProps = extractPropertiesFromTemplate(childCreate[2], params);
    const child = await this.graph.createNode([childLabel], childProps);

    // Pull the relationship type from the SECOND CREATE.
    const relCreate = /CREATE\s+\([A-Za-z_]\w*\)-\[:([A-Za-z_]\w*)\]->\([A-Za-z_]\w*\)/i.exec(cypher);
    if (!relCreate) throw new Error(`PolyGraphBackend.executeMatchCreateCreate: no relationship CREATE: ${cypher}`);
    const relType = relCreate[1];
    await this.graph.createRelationship(parent.id, child.id, relType);
    return [];
  }

  /**
   * Pattern D: anchor MERGE.
   *   MATCH (s:Solution {namespace: $ns})
   *   MATCH (c:Contract {contractId: $cid, namespace: $ns})
   *   MERGE (s)-[:HAS_CONTRACT]->(c)
   *   RETURN s.name AS solutionName
   *
   * Also covers the COMPOSES MERGE (which RETURNs `count(child) AS
   * linked` — we synthesize the count by 1 when the rel was created
   * or already existed; 0 when one of the MATCHes missed).
   *
   * Native path: find both endpoints; if either misses, return zero
   * rows. Otherwise look for an existing rel of the requested type
   * in the requested direction; if none, create one.
   */
  private async executeAnchorMerge(
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    // The two MATCH clauses, in order.
    const matchRegex = /MATCH\s+\([A-Za-z_]\w*\s*:\s*([A-Za-z_]\w*)\s*\{([^}]*)\}\s*\)/gi;
    const matches: Array<{ label: string; filter: Record<string, unknown> }> = [];
    let mm: RegExpExecArray | null;
    while ((mm = matchRegex.exec(cypher)) !== null) {
      matches.push({
        label: mm[1],
        filter: extractPropertiesFromTemplate(mm[2], params),
      });
    }
    if (matches.length < 2) {
      throw new Error(`PolyGraphBackend.executeAnchorMerge: expected two MATCH clauses: ${cypher}`);
    }
    const [startSpec, endSpec] = matches;
    const starts = await this.graph.findNodes(
      startSpec.label,
      simpleFilterToPolyGraph(startSpec.filter),
    );
    const ends = await this.graph.findNodes(
      endSpec.label,
      simpleFilterToPolyGraph(endSpec.filter),
    );
    if (starts.length === 0 || ends.length === 0) {
      // MATCH miss: zero rows.
      return [];
    }
    const start = starts[0];
    const end = ends[0];

    // Relationship type from the MERGE clause.
    const mergePart = /MERGE\s+\([A-Za-z_]\w*\)-\[:([A-Za-z_]\w*)\]->\([A-Za-z_]\w*\)/i.exec(cypher);
    if (!mergePart) {
      throw new Error(`PolyGraphBackend.executeAnchorMerge: no MERGE rel: ${cypher}`);
    }
    const relType = mergePart[1];

    // Look for an existing rel.
    const existing = await this.graph.findRelationships(relType);
    const already = existing.some((r) => r.startNode === start.id && r.endNode === end.id);
    if (!already) {
      await this.graph.createRelationship(start.id, end.id, relType);
    }

    // RETURN clause: build the result row from the materialized
    // bindings. Supported items: `s.<prop> AS <alias>` and
    // `count(<var>) AS <alias>` (1 when we created/found the rel,
    // 0 when we returned early above).
    const returnPart = /RETURN\s+([\s\S]+?)\s*$/i.exec(cypher);
    if (!returnPart) {
      return [{}];
    }
    const returnItems = returnPart[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const bindings: Record<string, { node: typeof start; index: number }> = {};
    // Map both endpoint variables. The cypher used by commit-contract.ts:
    //   MATCH (s:Solution {…}) MATCH (c:Contract {…}) MERGE (s)-[…]->(c)
    //   RETURN s.name AS solutionName
    // So we need a way to know which letter binds to which endpoint.
    // The MERGE clause itself names them.
    const mergeVarMatch = /MERGE\s+\(([A-Za-z_]\w*)\)-\[:[A-Za-z_]\w*\]->\(([A-Za-z_]\w*)\)/i.exec(
      cypher,
    );
    if (mergeVarMatch) {
      bindings[mergeVarMatch[1]] = { node: start, index: 0 };
      bindings[mergeVarMatch[2]] = { node: end, index: 1 };
    }

    const row: Record<string, unknown> = {};
    for (const item of returnItems) {
      // `count(<var>) AS <alias>`
      const countItem = /^count\s*\(\s*([A-Za-z_]\w*)\s*\)\s+AS\s+([A-Za-z_]\w*)\s*$/i.exec(item);
      if (countItem) {
        row[countItem[2]] = 1;
        continue;
      }
      // `<var>.<prop> AS <alias>`
      const propItem = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+AS\s+([A-Za-z_]\w*)\s*$/i.exec(item);
      if (propItem) {
        const b = bindings[propItem[1]];
        if (b) {
          row[propItem[3]] = b.node.properties[propItem[2]];
        }
        continue;
      }
      // `<var> AS <alias>` — not used by commit-contract.ts, but
      // included so a future caller doesn't silently get a no-op.
      const varItem = /^([A-Za-z_]\w*)\s+AS\s+([A-Za-z_]\w*)\s*$/i.exec(item);
      if (varItem) {
        const b = bindings[varItem[1]];
        if (b) row[varItem[2]] = b.node;
      }
    }
    return [row];
  }

  /**
   * Native primitives.
   *
   * `findNodes(label, filter)` → PolyGraph's own `findNodes` (already
   * shaped like our interface).
   * `findRelationships(type, filter)` → PolyGraph's `findRelationships`
   * but normalized to our id/startNode/endNode/properties shape.
   */
  native = {
    findNodes: async (
      label: string,
      filter?: Record<string, unknown>,
    ): Promise<Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>> => {
      const pgFilter = simpleFilterToPolyGraph(filter);
      const nodes = await this.graph.findNodes(label, pgFilter);
      return nodes.map((n) => ({
        id: String(n.id),
        labels: n.labels,
        properties: n.properties,
      }));
    },
    findRelationships: async (
      type: string,
      filter?: Record<string, unknown>,
    ): Promise<
      Array<{
        id: string;
        startNode: string;
        endNode: string;
        properties: Record<string, unknown>;
      }>
    > => {
      const pgFilter = simpleFilterToPolyGraph(filter);
      const rels = await this.graph.findRelationships(type, pgFilter);
      return rels.map((r) => ({
        id: String(r.id),
        startNode: String(r.startNode),
        endNode: String(r.endNode),
        properties: r.properties,
      }));
    },
  };

  async close(): Promise<void> {
    await this.graph.close();
  }
}

/**
 * Build a properties record by walking the cypher template's inline
 * `{key1: $param1, key2: $param2, key3: "literal"}` content and
 * looking each `$paramName` up in `params`. Literal strings,
 * numbers, booleans, and `null` are also recognized.
 *
 * // Why we parse the template ourselves: the v0.1.4 bridge's
 * // `parseInlineProps` does a naive comma-split which mangles any
 * // string property containing a `,`. By extracting properties
 * // straight from the original cypher template + the `params` object
 * // (NOT from an inlined cypher string), commas inside string values
 * // are irrelevant — we never tokenize the property values, just
 * // resolve their parameter references.
 *
 * Supports the small subset of inline-property values commit-contract.ts
 * emits:
 *   - `$paramName`        — looked up in params (any type)
 *   - `"literal string"`  — double-quoted string literal
 *   - `<number>`          — integer or float
 *   - `true` / `false`
 *   - `null`
 */
function extractPropertiesFromTemplate(
  propsText: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // The template is hand-written in commit-contract.ts so we can rely
  // on it being well-formed: `key: $param` pairs separated by commas,
  // possibly across newlines. Tokenize by walking with a small state
  // machine that skips whitespace, reads an identifier, expects ':',
  // reads a value token, expects ',' or end.
  let i = 0;
  const n = propsText.length;
  while (i < n) {
    // skip whitespace and commas
    while (i < n && /[\s,]/.test(propsText[i])) i++;
    if (i >= n) break;
    // read identifier
    let k = i;
    while (k < n && /[A-Za-z0-9_]/.test(propsText[k])) k++;
    if (k === i) {
      throw new Error(`extractPropertiesFromTemplate: expected identifier at offset ${i} in ${propsText}`);
    }
    const key = propsText.substring(i, k);
    i = k;
    // skip whitespace + colon
    while (i < n && /\s/.test(propsText[i])) i++;
    if (propsText[i] !== ':') {
      throw new Error(`extractPropertiesFromTemplate: expected ':' after '${key}' at offset ${i}`);
    }
    i++;
    // skip whitespace
    while (i < n && /\s/.test(propsText[i])) i++;
    // read value
    if (propsText[i] === '$') {
      // $paramName
      let v = i + 1;
      while (v < n && /[A-Za-z0-9_]/.test(propsText[v])) v++;
      const paramName = propsText.substring(i + 1, v);
      if (!(paramName in params)) {
        throw new Error(
          `extractPropertiesFromTemplate: param '$${paramName}' not in supplied params (keys: ${Object.keys(params).join(', ')})`,
        );
      }
      out[key] = params[paramName];
      i = v;
    } else if (propsText[i] === '"') {
      // "string literal" with backslash escapes
      const start = i;
      i++;
      while (i < n) {
        if (propsText[i] === '\\') {
          i += 2;
          continue;
        }
        if (propsText[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out[key] = JSON.parse(propsText.substring(start, i));
    } else if (/[-\d]/.test(propsText[i])) {
      // number
      let v = i;
      while (v < n && /[-\d.]/.test(propsText[v])) v++;
      out[key] = Number(propsText.substring(i, v));
      i = v;
    } else if (/[a-zA-Z]/.test(propsText[i])) {
      // true / false / null
      let v = i;
      while (v < n && /[A-Za-z]/.test(propsText[v])) v++;
      const tok = propsText.substring(i, v).toLowerCase();
      if (tok === 'true') out[key] = true;
      else if (tok === 'false') out[key] = false;
      else if (tok === 'null') out[key] = null;
      else
        throw new Error(
          `extractPropertiesFromTemplate: unexpected token '${tok}' at offset ${i}`,
        );
      i = v;
    } else {
      throw new Error(
        `extractPropertiesFromTemplate: cannot parse value at offset ${i} in ${propsText}`,
      );
    }
  }
  return out;
}

/**
 * Substitute `$paramName` in a cypher string with the value from
 * `params`, JSON-encoded for safe inlining.
 *
 * Uses a single regex pass with a substitution function so a value
 * containing `$something` text cannot trigger a cascading replacement.
 *
 * Only used for the queries we route through the bridge (the read
 * path and the simple anchor checks). The write path is short-
 * circuited to native primitives in `query()` itself, because the
 * v0.1.4 bridge's `parseInlineProps` does a naive comma-split and
 * its `parseValue` is a string-slice rather than `JSON.parse`, which
 * mangles any property value containing a comma, an unescaped paren,
 * or an embedded quote.
 */
function inlineParams(cypher: string, params: Record<string, unknown>): string {
  return cypher.replace(/\$([A-Za-z_]\w*)/g, (_match, name: string) => {
    if (!(name in params)) {
      // Leave it intact — caller may have meant a literal `$foo`. If
      // the bridge sees it, the bridge will surface the error.
      return `$${name}`;
    }
    const v = params[name];
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  });
}

/**
 * Sort an array of rows by a simple `ORDER BY` expression.
 *
 * Supported forms (everything contract-loader uses):
 *   - `c.archetypeName`          → sort ascending by row[archetypeName] alias
 *   - `c.archetypeName ASC|DESC`
 *
 * We resolve the expression to a row key heuristically: the part
 * after the last dot is the alias contract-loader's RETURN clauses
 * use (`RETURN c.archetypeName AS archetypeName`). If that alias
 * isn't present we fall through to using the whole expression
 * verbatim — which matches what Neo4j would do for a literal alias.
 *
 * // Why this isn't a real cypher parser: the bridge will graduate to
 * // qengine which handles ORDER BY for real. This is a temporary
 * // compatibility shim for v0.1.4.
 */
function sortRowsByExpression(
  rows: Array<Record<string, unknown>>,
  expr: string,
): void {
  // Strip trailing semicolons, parens, etc.
  const cleaned = expr.replace(/;\s*$/, '').trim();
  const m = /^(.+?)(?:\s+(ASC|DESC))?$/i.exec(cleaned);
  if (!m) return;
  const rawKey = m[1].trim();
  const direction = (m[2] ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1;

  // Prefer the alias-style key (text after the last dot), then the
  // whole expression.
  const dotIdx = rawKey.lastIndexOf('.');
  const aliasKey = dotIdx >= 0 ? rawKey.slice(dotIdx + 1) : rawKey;

  rows.sort((a, b) => {
    const av = pickKey(a, aliasKey, rawKey);
    const bv = pickKey(b, aliasKey, rawKey);
    if (av === bv) return 0;
    if (av === undefined || av === null) return direction * 1;
    if (bv === undefined || bv === null) return direction * -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return direction * (av - bv);
    }
    return direction * String(av).localeCompare(String(bv));
  });
}

function pickKey(
  row: Record<string, unknown>,
  primary: string,
  fallback: string,
): unknown {
  if (primary in row) return row[primary];
  if (fallback in row) return row[fallback];
  return undefined;
}

/**
 * Translate the simple `{prop: value}` filter shape we use across
 * backends into PolyGraph's `PropertyFilter` shape (which uses
 * comparator objects like `{$eq: value}`).
 *
 * Only equality is supported here — that's all contract-loader emits.
 * If the filter is undefined or empty we return undefined so PolyGraph
 * skips the filter step.
 */
function simpleFilterToPolyGraph(
  filter: Record<string, unknown> | undefined,
): Record<string, { $eq: unknown }> | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  const out: Record<string, { $eq: unknown }> = {};
  for (const [k, v] of Object.entries(filter)) {
    out[k] = { $eq: v };
  }
  return out;
}
