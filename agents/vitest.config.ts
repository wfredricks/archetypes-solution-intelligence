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
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: ['src/**/*.ts'],
      // Why: src/index.ts is a barrel re-export; in-process coverage on
      // a re-export file is uninformative. The library surface is
      // exercised through the agent entry points (completeness-agent,
      // bookend-audit-agent) and formatters. Match the cli/contract-loader
      // convention of excluding the barrel.
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
