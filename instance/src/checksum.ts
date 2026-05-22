/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.2.
 *
 *   Doctrine: INSTANCE-PORTABILITY.md §"Schema versioning" — the
 *   manifest carries a sigChecksum so a round-trip can prove it
 *   produced the same SIG bytes.
 *
 *   Ownership: asi-local. Lifts to canonical reference-impl.
 */

/**
 * sha256 helper used by the exporter for the manifest's `sigChecksum`
 * field.
 *
 * Streams two files (`sig/nodes.jsonl` then `sig/edges.jsonl`) into a
 * single hash so a re-export of a round-tripped instance produces the
 * SAME hash byte-for-byte (modulo ordering — see below). The order
 * matters: the exporter MUST write nodes.jsonl first, then edges.jsonl.
 *
 * // Why concatenated and not two separate hashes: one hash is one
 * // field in the manifest; the round-trip integrity test wants a
 * // single equality check. If we ever need per-file hashes we add
 * // them as separate fields without changing this contract.
 *
 * // Ordering caveat: the exporter writes nodes in label-then-id order
 * // and edges in startNode-then-type order so the hash is stable
 * // across re-exports of the same instance. See export.ts for the
 * // sort discipline.
 *
 * @module checksum
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Compute sha256 over the concatenation of two files. Returns a
 * `sha256:<lowercase-hex>` string suitable for direct insertion
 * into the manifest's `sigChecksum` field.
 */
export async function sha256OfFiles(paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const p of paths) {
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(p);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
  }
  return `sha256:${hash.digest('hex')}`;
}
