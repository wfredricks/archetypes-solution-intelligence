/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.2/§3.3.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Reversibility" — JSONL where
 *   it makes sense; this is the SIG-export portion.
 *
 *   Ownership: asi-local. Lifts to canonical
 *   archetypes/solution-intel/reference-impl/instance/src/format.ts.
 */

/**
 * JSONL serializers/deserializers for the SIG export.
 *
 * `nodes.jsonl` line shape:
 *   {"id":"abc","labels":["Contract"],"properties":{"...":"..."}}
 *
 * `edges.jsonl` line shape:
 *   {"id":"e1","startNode":"abc","endNode":"def","type":"HAS_CONTRACT","properties":{}}
 *
 * Both shapes are intentionally backend-agnostic — they do not mention
 * leveldb keys, Neo4j elementIds, or any other implementation detail.
 * The exporter is responsible for translating from the backend's native
 * shape to this format; the importer does the reverse.
 *
 * Lines are newline-terminated UTF-8. No trailing whitespace. No
 * blank lines. Property values are JSON-encoded; the consumer is
 * responsible for any subsequent decoding (e.g. ISO-8601 → DateTime).
 *
 * @module format
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Node row written to `sig/nodes.jsonl`.
 *
 * `id` is the original backend id, lossless. On PolyGraph this is the
 * leveldb-assigned id (preserved on round-trip by passing it back to
 * `createNode`). On Neo4j it is the original elementId; the importer
 * cannot mint that id back (Neo4j owns id allocation), so it ALSO
 * appears in `properties._originalId` on the Neo4j path. See
 * INSTANCE-PORTABILITY.md §"Identity preservation".
 */
export interface NodeRow {
  readonly id: string;
  readonly labels: readonly string[];
  readonly properties: Record<string, unknown>;
}

/**
 * Edge row written to `sig/edges.jsonl`.
 *
 * Neither backend supports caller-chosen relationship ids on create.
 * The original id is therefore written to `properties._originalId` on
 * both backends on round-trip. The `id` field above is the original
 * id verbatim; the importer maps it to whatever id the target backend
 * mints.
 */
export interface EdgeRow {
  readonly id: string;
  readonly startNode: string;
  readonly endNode: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

/**
 * Stream-write an array of node rows to a JSONL file. Returns the
 * number of rows written for the manifest's nodeCount field.
 */
export async function writeNodesJsonl(
  path: string,
  rows: AsyncIterable<NodeRow> | Iterable<NodeRow>,
): Promise<number> {
  return writeJsonl(path, rows);
}

export async function writeEdgesJsonl(
  path: string,
  rows: AsyncIterable<EdgeRow> | Iterable<EdgeRow>,
): Promise<number> {
  return writeJsonl(path, rows);
}

async function writeJsonl<T>(
  path: string,
  rows: AsyncIterable<T> | Iterable<T>,
): Promise<number> {
  // Why createWriteStream + manual write: streaming keeps memory bounded
  // when exporting 20k+ node SIGs. JSON.stringify per row is fine; the
  // adapter on the read side is what would have been the bottleneck.
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let count = 0;
  try {
    for await (const row of rows) {
      const line = JSON.stringify(row) + '\n';
      if (!stream.write(line)) {
        await new Promise<void>((resolve) => stream.once('drain', resolve));
      }
      count++;
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end((err: unknown) => (err ? reject(err as Error) : resolve()));
    });
  }
  return count;
}

/**
 * Read a JSONL file line-by-line, yielding parsed objects.
 *
 * Blank lines are skipped; lines that fail to parse throw an
 * informative error including the path and line number. This matches
 * the doctrine's reversibility obligation: an operator who has to
 * triage a malformed export gets a clear pointer to the bad line.
 */
export async function* readJsonl<T = unknown>(path: string): AsyncGenerator<T> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let n = 0;
  for await (const raw of rl) {
    n++;
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      yield JSON.parse(line) as T;
    } catch (err) {
      throw new Error(
        `${path}: failed to parse JSONL at line ${n}: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Read a JSONL file in full into an array. Use sparingly — for the
 * SIG export this materializes the whole graph; safe for the fixture
 * round-trip test but not for 100k-node engagements. The import path
 * uses the streaming form.
 */
export async function readJsonlAll<T = unknown>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const row of readJsonl<T>(path)) out.push(row);
  return out;
}
