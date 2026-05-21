/**
 * Provenance:
 *   Originated 2026-05-21 in archetypes-solution-intelligence (asi adoption)
 *   under BUILD-TASK-3-SIG-CONTRACTS-PLAN.md §Phase C.
 *
 *   Ownership: asi-local. Parser tolerance is deliberately narrow — it
 *   targets the LEFT-BOOKEND.md shape codified in METHODOLOGY.md §Bookends
 *   and exemplified by events-spine/LEFT-BOOKEND.md (the canonical
 *   instance going forward).
 */

/**
 * Reads a LEFT-BOOKEND.md file and parses it into a {@link ContractGraph}.
 *
 * // Why: The bookend is the canonical pre-build contract for an archetype
 * // (METHODOLOGY.md §Bookends). This parser is the bridge between markdown
 * // bookends (current canonical form) and graph contracts (future
 * // canonical form). Future LEFT-BOOKENDs are expected to follow the
 * // section-and-item conventions documented here; the parser stays simple
 * // by demanding consistency from authors rather than smartness from itself.
 *
 * Expected file shape:
 *   - Optional YAML front-matter between `---` markers carrying
 *     archetypeName, archetypeKind, archetypeVersion.
 *   - Section headers via `## <SectionName>` (or `## <Roman>. <SectionName>`).
 *     The parser keys off case-insensitive substring match against the
 *     section keyword (Principles, Constraints, Services, Processes,
 *     DataObjects, Compositions, Hypotheses).
 *   - Items within a section use `### <Key>:` or `### <KeyWord> <Key>:` —
 *     e.g. `### P1: Foo`, `### Principle P1: Foo`, `### S1: bar(...)`.
 *
 * Field extraction within an item uses bold labels:
 *   - `**Driver:**` (Principle)
 *   - `**Consequences:**` followed by a bullet list (Principle)
 *   - `**Alternative considered:**` or `**Alternative:**` (Principle)
 *   - `**Rationale:**` (Constraint)
 *   - `**Trigger:**`, `**Flow:**`, `**Cadence:**` (Process)
 *
 * @module parse-bookend
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type {
  BookendFrontMatter,
  Constraint,
  Contract,
  ContractGraph,
  DataObject,
  Hypothesis,
  Principle,
  Process,
  Service,
} from './types.js';

/**
 * Public entry point.
 *
 * Reads the file at `filePath`, parses it, and returns the resulting
 * graph payload. Throws on missing identity (no front-matter AND no
 * recognisable parent directory) so callers fail loud rather than ship
 * a contract with a synthetic name.
 */
export function parseBookend(filePath: string): ContractGraph {
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, 'utf8');
  const { frontMatter, body } = splitFrontMatter(raw);

  const contract = buildContract(absPath, frontMatter);
  const sections = splitSections(body);

  return {
    contract,
    principles: parsePrinciples(sections.principles ?? ''),
    constraints: parseConstraints(sections.constraints ?? ''),
    services: parseServices(sections.services ?? ''),
    processes: parseProcesses(sections.processes ?? ''),
    dataObjects: parseDataObjects(sections.dataObjects ?? ''),
    hypotheses: parseHypotheses(sections.hypotheses ?? ''),
    acceptanceCriteria: [],
    composes: parseCompositions(sections.compositions ?? ''),
  };
}

// ─── Front-matter ─────────────────────────────────────────────────────────────

interface SplitResult {
  frontMatter: BookendFrontMatter;
  body: string;
}

/**
 * Splits optional YAML front-matter from the markdown body.
 *
 * // Why: When present, front-matter is the most reliable source of
 * // archetype identity (name/kind/version). When absent, we fall back to
 * // path-based inference.
 */
function splitFrontMatter(raw: string): SplitResult {
  // YAML front-matter pattern: file starts with `---\n`, ends with `\n---\n`.
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontMatter: {}, body: raw };
  }
  const yamlBlock = match[1];
  const body = match[2];
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch (err) {
    throw new Error(
      `parse-bookend: invalid YAML front-matter: ${(err as Error).message}`,
    );
  }
  if (parsed && typeof parsed === 'object') {
    return { frontMatter: parsed as BookendFrontMatter, body };
  }
  return { frontMatter: {}, body };
}

// ─── Contract identity ────────────────────────────────────────────────────────

function buildContract(absPath: string, fm: BookendFrontMatter): Contract {
  const inferredName = inferArchetypeName(absPath);
  const archetypeName = fm.archetypeName ?? inferredName;
  if (!archetypeName) {
    throw new Error(
      `parse-bookend: cannot determine archetypeName for ${absPath} ` +
        '(provide YAML front-matter with archetypeName, or place the file under archetypes/<name>/LEFT-BOOKEND.md)',
    );
  }
  const archetypeKind = fm.archetypeKind ?? 'primitive';
  const archetypeVersion = fm.archetypeVersion ?? `lifted-${todayIsoDate()}`;
  return {
    archetypeName,
    archetypeKind,
    archetypeVersion,
    sourceBookend: absPath,
    contractId: `${archetypeName}-${archetypeVersion}`,
  };
}

function inferArchetypeName(absPath: string): string {
  // archetypes/<name>/LEFT-BOOKEND.md → "<name>"
  const file = basename(absPath);
  if (file.toLowerCase() === 'left-bookend.md') {
    return basename(dirname(absPath));
  }
  return basename(dirname(absPath));
}

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Section splitter ─────────────────────────────────────────────────────────

interface Sections {
  principles?: string;
  constraints?: string;
  services?: string;
  processes?: string;
  dataObjects?: string;
  compositions?: string;
  hypotheses?: string;
}

/**
 * Splits the body into named sections keyed off `## ` headers.
 *
 * // Why: Section numbering / roman numerals are author-discretionary
 * // ("II. Principles", "## Principles (reconstructed)") so we key off
 * // keyword presence in the heading text, not exact heading match.
 */
function splitSections(body: string): Sections {
  const lines = body.split('\n');
  const blocks: { heading: string; content: string[] }[] = [];
  let current: { heading: string; content: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) blocks.push(current);
      current = { heading: line.replace(/^##\s+/, ''), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) blocks.push(current);

  const result: Sections = {};
  for (const { heading, content } of blocks) {
    const text = content.join('\n');
    const h = heading.toLowerCase();
    // Order matters: dataobject must be tested before "object" alone, and
    // we use substring tests so "Principles (reconstructed)" matches.
    if (containsAny(h, ['principle'])) {
      result.principles = appendOrSet(result.principles, text);
    } else if (containsAny(h, ['constraint'])) {
      result.constraints = appendOrSet(result.constraints, text);
    } else if (containsAny(h, ['service'])) {
      result.services = appendOrSet(result.services, text);
    } else if (containsAny(h, ['process'])) {
      result.processes = appendOrSet(result.processes, text);
    } else if (
      containsAny(h, ['dataobject', 'data object', 'data objects', 'data structures'])
    ) {
      result.dataObjects = appendOrSet(result.dataObjects, text);
    } else if (containsAny(h, ['composition'])) {
      result.compositions = appendOrSet(result.compositions, text);
    } else if (containsAny(h, ['hypothesis', 'hypotheses'])) {
      result.hypotheses = appendOrSet(result.hypotheses, text);
    }
    // Unknown sections are silently ignored — bookends carry plenty of
    // narrative we deliberately do not graph (Scope, Status,
    // Methodological notes, etc.).
  }
  return result;
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function appendOrSet(prev: string | undefined, next: string): string {
  return prev ? `${prev}\n${next}` : next;
}

// ─── Per-section item splitter ────────────────────────────────────────────────

/**
 * Splits a section into items keyed off `### ` headers.
 *
 * Returns an array of `{ heading, body }` per item.
 */
function splitItems(sectionBody: string): { heading: string; body: string }[] {
  const lines = sectionBody.split('\n');
  const items: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (current) items.push(current);
      current = { heading: line.replace(/^###\s+/, ''), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) items.push(current);
  return items.map(({ heading, body }) => ({ heading, body: body.join('\n').trim() }));
}

/**
 * Extracts the item key and the item name from a heading.
 *
 * Examples:
 *   "Principle P1: Foo bar" → { key: "P1", name: "Foo bar" }
 *   "P1: Foo bar"           → { key: "P1", name: "Foo bar" }
 *   "S1: `publish(...)`"    → { key: "S1", name: "`publish(...)`" }
 *   "C2: Monthly key rotation with 3-day grace window" → { key: "C2", name: "..." }
 *
 * If no `<key>:` pattern is found, returns `{ key: heading, name: '' }`
 * (callers can still graph it as a stub).
 */
function parseHeading(
  heading: string,
  keyPrefixes: string[],
): { key: string; name: string } {
  // Strip a leading keyword like "Principle " if present.
  let h = heading.trim();
  for (const kw of ['Principle ', 'Constraint ', 'Service ', 'Process ', 'DataObject ']) {
    if (h.toLowerCase().startsWith(kw.toLowerCase())) {
      h = h.slice(kw.length);
      break;
    }
  }
  const m = h.match(/^([A-Za-z]+\d+(?:\.\d+)?):\s*(.*)$/);
  if (m) {
    const key = m[1];
    const name = m[2].trim();
    // Validate the key prefix matches expected (P, C, S, Pr, DO, H, AC).
    if (keyPrefixes.length === 0 || keyPrefixes.some((p) => key.startsWith(p))) {
      return { key, name };
    }
    // Heading looks like `<key>: ...` but the prefix doesn't match this
    // section's expected kind. Treat as untitled.
    return { key, name };
  }
  return { key: h, name: '' };
}

/**
 * Pulls the value of a bold-labeled field from a body block.
 *
 * Example: extractLabelled(body, 'Driver')
 *   matches:
 *     **Driver:** Some text spanning
 *     one or more lines until the next blank-line or **NextLabel:**.
 *
 * Returns '' if not found.
 */
function extractLabelled(body: string, label: string): string {
  const re = new RegExp(
    `\\*\\*${escapeRegex(label)}:?\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\*\\*[A-Z][^*]*:?\\*\\*|$)`,
    'i',
  );
  const m = body.match(re);
  if (!m) return '';
  return m[1].trim();
}

/** Pulls bullet items following a bold label. */
function extractBulletsAfter(body: string, label: string): string[] {
  const re = new RegExp(`\\*\\*${escapeRegex(label)}:?\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\*\\*[A-Z][^*]*:?\\*\\*|$)`, 'i');
  const m = body.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || l.startsWith('*'))
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First non-empty line of body, or '' — used as a fallback rationale. */
function firstSentence(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  return lines[0].replace(/^[>]\s*/, '');
}

// ─── Per-kind parsers ─────────────────────────────────────────────────────────

function parsePrinciples(section: string): Principle[] {
  const items = splitItems(section);
  const out: Principle[] = [];
  for (const { heading, body } of items) {
    const { key, name } = parseHeading(heading, ['P']);
    if (!/^P\d+/.test(key)) continue;
    const driver = extractLabelled(body, 'Driver');
    const consequences = extractBulletsAfter(body, 'Consequences');
    let alternative = extractLabelled(body, 'Alternative considered');
    if (!alternative) alternative = extractLabelled(body, 'Alternative');
    out.push({
      key,
      name,
      driver,
      consequences,
      alternativeConsidered: alternative,
    });
  }
  return out;
}

function parseConstraints(section: string): Constraint[] {
  const items = splitItems(section);
  const out: Constraint[] = [];
  for (const { heading, body } of items) {
    const { key, name } = parseHeading(heading, ['C']);
    if (!/^C\d+/.test(key)) continue;
    let rationale = extractLabelled(body, 'Rationale');
    if (!rationale) {
      // Many constraints write `MUST do X. **Rationale:** Y.` on one line;
      // fall back to body sans labels if extraction failed.
      rationale = body
        .replace(/\*\*[A-Z][^*]*:?\*\*/g, '')
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ');
    }
    out.push({ key, name, rationale });
  }
  return out;
}

function parseServices(section: string): Service[] {
  const items = splitItems(section);
  const out: Service[] = [];
  for (const { heading, body } of items) {
    const { key, name } = parseHeading(heading, ['S']);
    if (!/^S\d+/.test(key)) continue;
    // signature: prefer the first fenced code block in the body
    const fence = body.match(/```[a-z]*\n([\s\S]*?)\n```/i);
    const signature = fence ? fence[1].trim() : '';
    // description: the prose around the signature (first paragraph)
    const description = firstSentence(body);
    out.push({ key, name, signature, description });
  }
  return out;
}

function parseProcesses(section: string): Process[] {
  const items = splitItems(section);
  const out: Process[] = [];
  for (const { heading, body } of items) {
    const { key, name } = parseHeading(heading, ['Pr']);
    if (!/^Pr\d+/.test(key)) continue;
    const trigger = extractLabelled(body, 'Trigger');
    const cadence = extractLabelled(body, 'Cadence');
    const description = firstSentence(body);
    out.push({ key, name, trigger, cadence, description });
  }
  return out;
}

function parseDataObjects(section: string): DataObject[] {
  const items = splitItems(section);
  const out: DataObject[] = [];
  for (const { heading, body } of items) {
    const { key, name } = parseHeading(heading, ['DO']);
    if (!/^DO\d+/.test(key)) continue;
    const fence = body.match(/```[a-z]*\n([\s\S]*?)\n```/i);
    const schemaHint = fence ? fence[1].trim() : '';
    const description = firstSentence(body);
    out.push({ key, name, description, schemaHint });
  }
  return out;
}

function parseHypotheses(section: string): Hypothesis[] {
  // Hypotheses appear in two shapes:
  //   a) numbered list ("1. Foo. 2. Bar.")  — simple-auth, events-spine
  //   b) `### H<n>:` headers — possible future shape
  const out: Hypothesis[] = [];

  // Shape b)
  const headerItems = splitItems(section).filter((it) => /^H\d+/.test(parseHeading(it.heading, ['H']).key));
  for (const { heading, body } of headerItems) {
    const { key, name } = parseHeading(heading, ['H']);
    out.push({ key, text: name || firstSentence(body), status: 'open' });
  }

  if (out.length > 0) return out;

  // Shape a) — numbered list
  // Lines like `1. **The five Principles...**` or `1. Foo bar.`
  const lines = section.split('\n');
  let inList = false;
  let buffer = '';
  let counter = 0;
  const flush = () => {
    const text = buffer.trim();
    if (text) {
      counter += 1;
      out.push({ key: `H${counter}`, text, status: 'open' });
    }
    buffer = '';
  };
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      if (inList) flush();
      inList = true;
      buffer = m[2];
    } else if (inList) {
      if (line.trim() === '') {
        // peek: blank line breaks the list only if the next non-blank is
        // not an indented continuation. Simpler: treat blank as
        // potential terminator unless next line is also a numbered item.
        // We just append the blank to buffer; flush happens at next numbered or end.
        buffer += '\n';
      } else {
        buffer += ' ' + line.trim();
      }
    }
  }
  if (inList) flush();
  return out;
}

function parseCompositions(section: string): string[] {
  // Pull archetype names from a markdown table column "Composed archetype"
  // or backtick-wrapped names like `simple-pubsub`.
  const out = new Set<string>();
  for (const line of section.split('\n')) {
    // Table row: | `name` | kind | ... |
    const tableMatch = line.match(/\|\s*`([a-z][a-z0-9-]+)`\s*\|/);
    if (tableMatch) {
      out.add(tableMatch[1]);
      continue;
    }
    // Bullet form: `- ` followed by `name` (primitive)
    const bulletMatch = line.match(/^[-*]\s+`([a-z][a-z0-9-]+)`/);
    if (bulletMatch) {
      out.add(bulletMatch[1]);
    }
  }
  return Array.from(out);
}
