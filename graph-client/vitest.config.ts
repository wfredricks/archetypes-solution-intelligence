import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      // Why: Stage 2c ships a scaffold only — there is no implementation
      // to cover yet. Stage 3 raises these thresholds to match the cli
      // (80/80/80/80) once the graph client is implemented. Setting
      // thresholds to 0 keeps the gate in place mechanically (the
      // `test:coverage` script still runs and reports) without failing
      // on an empty re-export file.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
