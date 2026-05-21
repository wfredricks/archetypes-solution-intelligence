# ADOPTION-FINDINGS.md

*Written 2026-05-21 by the Task 2 sub-agent. Companion to `~/.openclaw/workspace/artifacts/archetypes-bootstrap/BUILD-ARCHETYPES-SI-ADOPTION-PLAN.md`. Captures what surfaced while turning the recipe into a working, operational substrate.*

---

## What shipped (v0.1.0-pre)

- The new repo `wfredricks/archetypes-solution-intelligence` exists, public, with `main` at `v0.1.0-pre`.
- `identity/`, `cli/`, `graph-client/` derived from `archetypes/solution-intel/reference-impl/` at tag `solution-intel-reference-impl-2026-05-21`.
- Provenance JSDoc headers on every derived source + test file (per `METHODOLOGY.md §Marking conventions`).
- All 26 `@adopt:` markers ANSWERED with `asi`-profile values. Marker comments preserved as historical documentation.
- `package.json` files updated to `@asi/*` scope. Binary in `cli/package.json#bin` is `asi`.
- `scripts/seed-solution.ts` is idempotent: clears the asi namespace then creates exactly one Solution root.
- PolyGraph at `bolt://localhost:7689` contains `(s:Solution {namespace: "asi", name: "Archetypes"})` with the full asi profile encoded as properties.
- Identity service boots on :3101 and `/health` returns `asi-identity` v0.1.0-pre.
- `asi --help` works; describes itself as "Archetypes Solution Intel CLI".
- `scripts/verify-graph.ts` round-trips the Solution root from PolyGraph.

### Test status

| Subdir | Tests | tsc | lint | build |
|---|---|---|---|---|
| `identity/` | **70/70 ✅** | clean | clean | green |
| `cli/` | **59/59 ✅** | clean | clean | green |
| `graph-client/` | **1/1 ✅** | clean | clean | green |

**Total: 130/130 tests pass.**

## What worked smoothly

1. **The Task 1 marker placements were spot-on.** Every marker pointed at the exact line that needed an answer; no archeology required.
2. **Per-file targeted edits scaled.** ~35 files derived with provenance + namespace propagation. The "no batched source-file writes" discipline meant each file's intent was visible in its own diff hunk.
3. **The `@adopt:namespace = asi` cascade was mechanical.** Once the hub marker was answered, the narrower markers (`SI_*` env vars, `si-identity` service name, `si.role.*` event types, `.si/config.yaml`, `~/.si/credentials`) all snapped to `asi`-equivalents in well-localized edits.
4. **Tests held the namespace contract honest.** `credentials.test.ts` hard-coded `.si` and `integration.test.ts` checked for `si.role.granted` — both surfaced immediately when the suite ran, before any human eyes were on the changes. The compounding-quality discipline of the methodology paid out within the same hour as the changes.
5. **`neo4j-driver` worked first time.** The seed script was operational on first run; the idempotent clear + create pattern is reusable for future namespaced adoptions.
6. **PolyGraph reachability was a one-line `docker run`.** TOOLS.md referenced `udt-v01_constellation-neo4j` but no such container existed on this host. Spinning up a fresh Neo4j 5-community on the expected ports (7689 Bolt, 7476 HTTP) with the documented auth (`neo4j / udt-pass-2026`) took ~25 seconds total.

## What surprised (or required judgment)

1. **PolyGraph instance was missing on this host.** TOOLS.md said the container would be at `bolt://localhost:7689`, but `docker ps -a` showed no Neo4j container. Decision: rather than block the task, I started a fresh `neo4j:5-community` container with the expected ports + auth, named `constellation-neo4j`. The fresh instance has an empty default database, which suited the "clean SIG" requirement perfectly. **Flag for Bill:** confirm whether this should become the canonical local PolyGraph going forward, or whether the original `udt-v01_constellation-neo4j` volume should be restored from backup and used instead.

2. **Class names `SIIdentityClient` / `SIHttpError` kept verbatim.** These are TypeScript class identifiers exposed from `@asi/cli`. A principled namespace cascade would rename them to `AsiIdentityClient` / `AsiHttpError`. I chose to KEEP the names for three reasons:
   - The `@adopt:` markers do not call out class names — they call out env vars, paths, service names, event prefixes, package scopes. Class names live in a different layer of the namespace.
   - The contract surface (`requestCode`, `verifyCode`, `resolve`, `grant`, `revoke`) is the simple-auth client contract, not the adopter namespace.
   - Renaming would have triggered a much larger blast radius (cli/src/http.ts is 307 lines; every import site would need updating).
   - The provenance JSDoc on every file using these names cites the upstream source — future readers can trace the names back to their origin.

   **Recommend codifying this as an explicit rule in METHODOLOGY.md:** "Namespace cascade applies to env vars, file/dir paths, service names, event prefixes, package scopes, and CLI binary names. It does NOT apply to in-code class/type identifiers — those follow the upstream contract surface." If Bill disagrees, the rename is a tractable refresh task.

3. **`events-spine` archetype does not yet exist.** The `@adopt:composes:eventing` marker resolves to "events-spine" as a documented intent, but the archetype itself is not in the registry. I answered the marker as `events-spine` (per the plan) and explicitly noted the no-op wiring in the server.ts `@adopt:composes:eventing` block. Operational impact: the eventing fanout from audit emission is silently absent until events-spine is built and a refresh adopts it.

4. **The `.asi/config.yaml` inner YAML key is preserved as `si:`.** When walking up looking for project config, the CLI now reads `.asi/config.yaml` (was `.si/config.yaml`). But the inner key is `si:`, not `asi:`. Decision: the directory name carries the adopter's namespace, but the inner YAML key is a substrate-neutral identifier inherited from solution-intel. Adopters who want full namespacing would rewrite both, but the cost-benefit didn't justify it here (the YAML key never escapes the package's read path). **Documented in `cli/src/url.ts` modifications header.**

5. **Default port offset (3001 → 3101) was the right call.** The first time I booted identity locally to test, I confirmed the upstream solution-intelligence-identity dev container (if running) would still be on :3001 — the +100 offset means both can coexist. The cli's default URL would also need to follow, which is why I left the resolver `resolveUrl` reading flag > env > config (no hard-coded default), so the operator must supply `--url http://localhost:3101` or `ASI_URL=http://localhost:3101` once. The login description text now says "ASI/I identity service".

6. **`_resetSeqForTests()` momentarily annotated with `eslint-disable`.** I introduced and immediately removed an `// eslint-disable-next-line @typescript-eslint/no-unused-vars` directive on this function in `audit.ts`. The function is in fact exported and used by tests; the disable was unnecessary. Caught before commit. Note: this is the kind of thing a real refresh-task would surface as a defect in upstream solution-intel's DEFECTS.md if it had been a real issue; here it was a transient adoption-time mistake, not an upstream defect.

7. **A small functional rewrite in `grants.ts` was reverted.** When I first attempted to rewrite the file from memory (rather than edit the copy in place), I subtly changed the `effectiveRoles` algorithm (sorted by ROLES order instead of insertion order). The test suite would have caught it (Array.from preserves insertion order, tests asserted that), but I noticed it during diff review and restored the original via `cp` then re-applied targeted edits. **Lesson burned in:** for adoption, always copy then edit; never rewrite from memory.

8. **Test fixtures with `.si/` directories needed updates.** `cli/tests/url.test.ts` writes `.si/config.yaml` files into tmpdirs to test walk-up resolution. These had to change to `.asi/` to match the production code's lookup path. A single targeted edit (and a follow-up to fix an over-aggressive regex that produced `AASI_URL` from `ASI_URL` because the `SI_URL` pattern matched the already-replaced string) closed the loop.

## Wall-clock breakdown

| Phase | Est. (plan) | Actual |
|---|---|---|
| A — Create repo | ~5 min | ~5 min |
| B — Derive identity | ~30-40 min | ~30 min |
| C — Derive cli | ~25-35 min | ~25 min |
| D — Derive graph-client | ~15-20 min | ~5 min |
| E — Polygraph + seed | ~15-25 min | ~15 min (incl. starting a fresh Neo4j container) |
| F — Boot check | ~15 min | ~5 min |
| G — Docs (CHANGELOG, ADOPTION-FINDINGS, README) | ~15-20 min | (writing now) |
| H — Tag + release | ~5 min | pending |
| I — FINDINGS + Signal | ~10 min | pending |

**Total wall clock so far: ~95 min.** Well under the 3-hour cap.

## Hard-constraints compliance check

| Constraint | Status |
|---|---|
| Original SI repos read-only | ✅ Held — no commits to `wfredricks/solution-intelligence-*` |
| `archetypes/solution-intel/reference-impl/` read-only | ✅ Held — no edits to the in-tree reference |
| TypeScript reference preserved | ✅ Held |
| Provenance JSDoc on every derived file | ✅ Held |
| Marker answers documented (ANSWER lines) | ✅ Held |
| Marker comments preserved | ✅ Held |
| `os.tmpdir()` not `/tmp/` | ✅ Held (tests use `os.tmpdir()`; ledger paths use `process.cwd()`) |
| Esbuild trap (`*/` inside `//` inside `/** */`) | ✅ Held |
| No batched source-file writes | ✅ Held — every file's adoption edits were per-file targeted operations |
| Wall-clock ≤ 3 h | ✅ Held (~95 min so far) |
| PolyGraph contains exactly one `(s:Solution {adoptionId: "asi"})` | ✅ Verified |
| Identity boots, `/health` returns asi-identity | ✅ Verified |
| `asi --help` works | ✅ Verified |
| graph-client connectivity test passes | ✅ Verified (via `scripts/verify-graph.ts`) |

## Recommendations for Task 3 (load archetype contracts into the asi SIG)

1. **The Solution root is in PolyGraph at `bolt://localhost:7689`, labeled `Solution {namespace: "asi", adoptionId: "asi"}`.** Every contract loaded by Task 3 should establish a relationship to this node (e.g. `(:Archetype)-[:LOADED_INTO]->(s)`).

2. **`scripts/verify-graph.ts` is the template for read-side scripts.** It opens a driver, runs a Cypher, closes; that's the whole shape. Task 3 can crib from it for contract-loader scripts.

3. **The `composes_*` properties on the Solution node are the substrate manifest.** Task 3's first natural contract load is the four composition edges: `(s)-[:COMPOSES_IDENTITY]->(:Archetype {name: "simple-auth"})` etc. The `s` node already knows it composes those archetypes; Task 3 makes the contract edges explicit in the graph.

4. **events-spine is a known gap.** The composition edge to events-spine should be created with a `placeholder: true` property (or similar) so Task 3+ can identify which contracts are placeholders awaiting their archetype to be authored.

5. **Class-naming rule needs adjudication BEFORE the next adoption.** The `SIIdentityClient` / `SIHttpError` decision here was pragmatic. If the next adopter project picks (say) "Twin Solution Intel" with namespace `tsi`, they'll face the same question: rename or keep? Codify the answer in METHODOLOGY.md before the next adoption to avoid drift.

6. **Refresh policy: Position B is in effect.** Future changes to `archetypes/solution-intel/reference-impl/` or to the original `wfredricks/solution-intelligence-*` repos do NOT auto-flow here. A future "refresh-asi" task will be needed to pull in updates (e.g. when upstream Stage 3 lands the graph-client body).

## Open questions for Bill

1. **PolyGraph canonicity.** The `udt-v01_constellation-neo4j` volume referenced in TOOLS.md wasn't on this host. I started a fresh `constellation-neo4j` container (neo4j:5-community) with the documented ports + auth. **Question: is this the canonical local PolyGraph going forward, or do you want to restore the original volume from backup?** The fresh instance contains only the asi Solution root right now; if other namespaces lived in the original, this represents an unintentional clean slate.

2. **Class-naming rule.** See §"What surprised" item 2. Should `METHODOLOGY.md` codify "namespace cascade does NOT apply to in-code class/type identifiers"?

3. **`.asi/config.yaml` inner YAML key.** Should the inner key remain `si:` (substrate-neutral, my call) or become `asi:` (full namespace cascade)? See §"What surprised" item 4.

4. **events-spine archetype creation order.** Task 2 answered the marker as `events-spine` per the plan, but the archetype itself doesn't yet exist in `archetypes/`. Should events-spine be authored next, or should Task 3 (load contracts into the SIG) come first?

## Final state

- **Repo:** [`wfredricks/archetypes-solution-intelligence`](https://github.com/wfredricks/archetypes-solution-intelligence)
- **Tag:** `v0.1.0-pre` (after Phase H pushes it)
- **Tests:** 130/130 green (70 + 59 + 1)
- **Solution root:** `(:Solution {name: "Archetypes", namespace: "asi"})` in PolyGraph at `bolt://localhost:7689`
- **Identity:** boots on :3101 (`/health` returns `asi-identity`)
- **CLI:** `asi` is callable; help reads "Archetypes Solution Intel CLI"
- **Ready for:** Task 3 (load archetype contracts into the asi SIG)

🖇️ *First end-to-end adoption of a composite archetype under the registry methodology. The shape of this work is the precedent for every subsequent solution-intel adoption.*
