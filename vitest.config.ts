import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
