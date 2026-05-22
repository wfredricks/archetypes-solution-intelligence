import { defineConfig } from 'tsup';

// Why: agents ships a single library entrypoint (src/index.ts) consumed
//      by the @asi/cli `agents` command group. No bin shim here — the
//      CLI wires the agents into its own commander program.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
