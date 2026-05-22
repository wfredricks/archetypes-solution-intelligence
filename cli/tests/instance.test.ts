/**
 * Provenance:
 *   Originated 2026-05-22 in archetypes-solution-intelligence (asi)
 *   under BUILD-PHASE-3-PLAN.md §3.6.
 *
 *   Ownership: asi-local.
 */

/**
 * Unit tests for the `asi instance` CLI wiring.
 *
 * // Why: instance/tests/roundtrip.test.ts pins the runtime contract
 * // (export → tar.gz → import → SIG matches). These tests cover the
 * // CLI layer (flag parsing, exit codes, missing-option diagnostics,
 * // output shape). We mock `@asi/instance` so no leveldb or Neo4j is
 * // touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';

vi.mock('@asi/instance', () => {
  return {
    exportInstance: vi.fn(async (opts: { output: string; namespace: string; backend: 'polygraph' | 'neo4j' }) => ({
      outputPath: opts.output,
      manifest: {
        exportSchemaVersion: '0.1.0',
        substrateName: 'solution-intel',
        substrateVersion: '0.2.0-pre',
        instanceSchemaVersion: '0.2.0-pre',
        namespace: opts.namespace,
        backend: opts.backend,
        createdAt: '2026-05-22T20:00:00.000Z',
        createdBy: 'asi instance export',
        nodeCount: 42,
        edgeCount: 73,
        auditEventCount: 5,
        identityGrantCount: 2,
        sigChecksum: 'sha256:abc',
      },
    })),
    importInstance: vi.fn(async (opts: { input: string; namespace: string; backend: 'polygraph' | 'neo4j' }) => ({
      manifest: {
        exportSchemaVersion: '0.1.0',
        substrateName: 'solution-intel',
        substrateVersion: '0.2.0-pre',
        instanceSchemaVersion: '0.2.0-pre',
        namespace: opts.namespace,
        backend: opts.backend,
        createdAt: '2026-05-22T20:00:00.000Z',
        createdBy: 'asi instance export',
        nodeCount: 42,
        edgeCount: 73,
        auditEventCount: 5,
        identityGrantCount: 2,
        sigChecksum: 'sha256:abc',
      },
      nodesImported: 42,
      edgesImported: 73,
      auditEventsAppended: 5,
      identityGrantsAppended: 2,
      migrationsApplied: 0,
      edgeIdMap: {},
      nodeIdMap: {},
      warnings: [],
    })),
  };
});

import {
  instanceExportCommand,
  instanceImportCommand,
} from '../src/commands/instance.js';

interface CapturedStreams {
  stdout: PassThrough;
  stderr: PassThrough;
  out: string;
  err: string;
}

function captureStreams(): CapturedStreams {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const captured: CapturedStreams = { stdout, stderr, out: '', err: '' };
  stdout.on('data', (chunk) => {
    captured.out += chunk.toString();
  });
  stderr.on('data', (chunk) => {
    captured.err += chunk.toString();
  });
  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('asi instance export — CLI wiring', () => {
  it('returns exit code 2 when --output is missing', async () => {
    const streams = captureStreams();
    const exit = await instanceExportCommand({
      backend: 'polygraph',
      polygraphPath: '/tmp/x',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(2);
    expect(streams.err).toMatch(/--output is required/);
  });

  it('returns exit code 2 when --polygraph-path is missing for backend=polygraph', async () => {
    const streams = captureStreams();
    const exit = await instanceExportCommand({
      output: '/tmp/out.tar.gz',
      backend: 'polygraph',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(2);
    expect(streams.err).toMatch(/--polygraph-path/);
  });

  it('returns exit code 2 when --graph-url is missing for backend=neo4j', async () => {
    const streams = captureStreams();
    const exit = await instanceExportCommand({
      output: '/tmp/out.tar.gz',
      backend: 'neo4j',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(2);
    expect(streams.err).toMatch(/--graph-url/);
  });

  it('returns exit code 2 for an unknown backend', async () => {
    const streams = captureStreams();
    const exit = await instanceExportCommand({
      output: '/tmp/out.tar.gz',
      backend: 'foo',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(2);
    expect(streams.err).toMatch(/unknown --backend/);
  });

  it('exit code 0 + prints manifest summary on success (polygraph)', async () => {
    const streams = captureStreams();
    const exit = await instanceExportCommand({
      output: '/tmp/out.tar.gz',
      backend: 'polygraph',
      polygraphPath: '/tmp/poly',
      namespace: 'asi',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(0);
    expect(streams.out).toMatch(/wrote \/tmp\/out\.tar\.gz/);
    expect(streams.out).toMatch(/nodes:\s+42/);
    expect(streams.out).toMatch(/edges:\s+73/);
    expect(streams.out).toMatch(/checksum:\s+sha256:abc/);
  });
});

describe('asi instance import — CLI wiring', () => {
  it('returns exit code 2 when --input is missing', async () => {
    const streams = captureStreams();
    const exit = await instanceImportCommand({
      backend: 'polygraph',
      polygraphPath: '/tmp/x',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(2);
    expect(streams.err).toMatch(/--input is required/);
  });

  it('exit code 0 + prints summary on success (polygraph)', async () => {
    const streams = captureStreams();
    const exit = await instanceImportCommand({
      input: '/tmp/in.tar.gz',
      backend: 'polygraph',
      polygraphPath: '/tmp/poly',
      namespace: 'asi',
      stdout: streams.stdout,
      stderr: streams.stderr,
    });
    expect(exit).toBe(0);
    expect(streams.out).toMatch(/nodes imported:\s+42/);
    expect(streams.out).toMatch(/edges imported:\s+73/);
    expect(streams.out).toMatch(/migrations applied:\s+0/);
  });
});
