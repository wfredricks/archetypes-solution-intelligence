import { defineConfig } from 'tsup';

// Why: graph-client ships a single library entrypoint (src/index.ts).
//      Stage 2c is scaffold-only; Stage 3 fills in the client modules
//      that this file re-exports.
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
