import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/generated/**',
    'src/components/ui/**',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
  ]),
  {
    // Playwright's fixtures are written with a function called `use`, which the rules of React's hooks take for a hook.
    files: ['qa/browsers/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
]);

export default eslintConfig;
