import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import thresholds from './coverage-thresholds.json';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'docker/**/*.test.ts',
      'scripts/**/*.test.ts',
      'qa/**/*.test.ts',
    ],
    // next-auth and next-intl import "next/server" or "next/navigation" without an extension, which Node's own ESM
    // loader rejects; inlining lets Vite resolve it (and lets tests mock next/headers).
    server: { deps: { inline: ['next-auth', 'next-intl'] } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'docker/**/*.mjs', 'scripts/**/*.mjs', 'qa/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'src/generated/**',
        // shadcn/ui: generated code, never hand-edited (see docs/architecture.md)
        'src/components/ui/**',
        'src/test/**',
        'qa/cli.ts',
        // gates and tools that CI runs by themselves (a failure shows there), not product code
        'scripts/docs-screenshots.mjs',
        'scripts/check-docs.mjs',
        'scripts/audit-prod.mjs',
        'scripts/coverage-gaps.mjs',
        'scripts/coverage-report.mjs',
        'qa/smoke.ts',
        'qa/test-database.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      // The floors are a ratchet kept in a file of their own (see coverage-thresholds.json).
      thresholds: { ...thresholds.global, ...thresholds.areas },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
