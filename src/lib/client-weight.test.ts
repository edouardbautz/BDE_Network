// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What every page loads first is part of what the platform weighs on a phone with a slow network. Zod (about 27 KiB on the wire) was
 * once in it, brought by two lines: the list of languages lived in the schema of the configuration, and the routing, the language
 * menus and so every page imported it from there. Nothing that every page loads may reach Zod or the schema again (the forms that
 * validate in the browser load them on their own pages).
 */
const root = process.cwd();
const SHARED_CLIENT_ENTRIES = [
  'src/i18n/routing.ts',
  'src/i18n/navigation.ts',
  'src/i18n/link.tsx',
  'src/components/locale-switcher.tsx',
  'src/components/layout/account-preferences.tsx',
  'src/components/layout/lazy-toaster.tsx',
  'src/components/theme-provider.tsx',
  'src/components/theme-toggle.tsx',
];
const FORBIDDEN = /^(zod|@\/config\/schema|@\/config\/index|@\/config|@\/lib\/zod-config)$/;

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(root, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function reaches(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (file: string, via: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    )) {
      if (match[1]) continue; // `import type`: erased
      const specifier = match[2] ?? match[3]!;
      if (FORBIDDEN.test(specifier))
        found.push([...via, relative(root, file), specifier].join(' -> '));
      const next = resolveImport(file, specifier);
      if (next) visit(next, [...via, relative(root, file)]);
    }
  };
  visit(join(root, entry), []);
  return found;
}

describe('what every page loads first', () => {
  it.each(SHARED_CLIENT_ENTRIES)(
    '%s does not reach Zod or the schema of the configuration',
    (entry) => {
      expect(reaches(entry)).toEqual([]);
    },
  );

  it('can see an import chain (the walk is not blind)', () => {
    // schema.ts imports zod: starting from it, the walk must find it
    const source = readFileSync(join(root, 'src/config/schema.ts'), 'utf8');
    expect(source).toMatch(/from 'zod'/);
    expect(reaches('src/config/schema.ts').length).toBeGreaterThan(0);
  });
});
