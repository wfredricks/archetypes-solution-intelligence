/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence under
 *   BUILD-PHASE-1B-PLAN.md §C.7.
 *
 *   Ownership: asi-local.
 *
 * @module bookend-audit/parse-snapshot
 */

/**
 * Tolerant parser for committed RIGHT-BOOKEND-snapshot-*.md files.
 *
 * // Why: the BookendAuditAgent compares SIG-current hypothesis rows
 * // against the committed snapshot file's table. The committed file
 * // is human-authored markdown; the parser must tolerate the variations
 * // that real snapshots exhibit (escaped pipes, bolded status cells,
 * // stray whitespace, hypothesis text containing pipes that were
 * // backslash-escaped during generation).
 *
 * // Reads the canonical shape produced by
 * // `archetypes-solution-intelligence/scripts/snapshot-events-spine.ts`:
 * //
 * //   | Key | Text (one-line) | Status | Evidence |
 * //   |-----|------------------|--------|----------|
 * //   | H1  | ...             | **held** | ...     |
 */

/** A single hypothesis row parsed from a committed snapshot. */
export interface ParsedSnapshotRow {
  key: string;
  text: string;
  status: string;
  evidence: string;
}

/** Parse the snapshot markdown body and return its hypothesis rows. */
export function parseSnapshot(markdown: string): ParsedSnapshotRow[] {
  const rows: ParsedSnapshotRow[] = [];
  const lines = markdown.split(/\r?\n/);
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      // Why: blank lines / prose between table chunks break the table
      // context; the header re-detector below picks up subsequent tables.
      inTable = false;
      continue;
    }
    if (isHeaderLine(line)) {
      inTable = true;
      continue;
    }
    if (isSeparatorLine(line)) {
      // The `|---|---|` divider; safe to skip while staying in table mode.
      continue;
    }
    if (!inTable) continue;

    const cells = splitRow(line);
    if (cells.length < 4) continue;
    const [key, text, status, evidence] = cells;
    if (!/^H\d+$/i.test(key.trim())) continue;
    rows.push({
      key: key.trim(),
      text: text.trim(),
      status: stripStatusEmphasis(status.trim()),
      evidence: evidence.trim(),
    });
  }
  return rows;
}

/**
 * Split a markdown table row, honoring backslash-escaped pipes.
 *
 * // Why: snapshot generation escapes `|` inside cell text to `\|`;
 * // a naive `split('|')` would break on that.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      buf += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  // Leading and trailing splits produce empty cells (because the line
  // starts/ends with `|`); strip those.
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

function isHeaderLine(line: string): boolean {
  // Detects the literal header used by snapshot-events-spine.ts.
  return /^\|\s*Key\s*\|\s*Text/i.test(line);
}

function isSeparatorLine(line: string): boolean {
  return /^\|\s*-+/.test(line);
}

/** Strip surrounding `**` from a status cell (the canonical format bolds it). */
function stripStatusEmphasis(s: string): string {
  const m = s.match(/^\*\*(.+)\*\*$/);
  return m ? m[1].trim() : s;
}
