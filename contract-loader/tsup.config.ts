import { defineConfig } from 'tsup';

// Why: contract-loader ships a single library entrypoint (src/index.ts)
//      plus the CLI-driven load-contracts script lives in
//      archetypes-solution-intelligence/scripts/. Only the library is
//      compiled here; the script runs under tsx.
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
