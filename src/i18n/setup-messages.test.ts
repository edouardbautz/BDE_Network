// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * The installer answers with CODES (src/lib/setup/validate.ts, the actions): the page turns each into a sentence.
 * A code without a sentence would show "Something went wrong" for a problem the person can fix.
 */

const catalogs = { fr: fr.setup, en: en.setup } as const;

const VALIDATOR_CODES = [
  'name',
  'color',
  'timezone',
  'address',
  'clientId',
  'clientSecret',
  'swapped',
  'login',
  'discord',
  'slack',
  'smtpHost',
  'port',
  'email',
  'secretChars',
  'campus',
];

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The codes the actions can answer with (`fail('code'` and `fail(error.code`). */
const actionCodes = [
  ...read('../app/[locale]/setup/actions.ts').matchAll(/fail\('([A-Za-z]+)'/g),
].map((match) => match[1] as string);

describe.each(Object.entries(catalogs))('setup messages (%s)', (_lang, catalog) => {
  const errors = catalog.errors as Record<string, string>;

  it.each(VALIDATOR_CODES)('has a sentence for the validator code %s', (code) => {
    expect(errors[code]).toBeTruthy();
  });

  it('has a sentence for every code the actions answer with (or says it elsewhere)', () => {
    // testFailed is told by the notifications step itself, with the reason
    const elsewhere = new Set(['testFailed']);
    const missing = actionCodes.filter((code) => !elsewhere.has(code) && !errors[code]);
    expect(missing).toEqual([]);
    expect(actionCodes.length).toBeGreaterThan(15);
    expect((catalog.notifications as Record<string, string>).testFailed).toBeTruthy();
  });

  it('has one name for each of the 8 steps, and no empty message', () => {
    expect(catalog.progress.steps).toHaveLength(8);
    const empty: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (node.trim() === '') empty.push(path);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
      }
    };
    walk(catalog, 'setup');
    expect(empty).toEqual([]);
  });

  it('never tells the person to open a configuration file', () => {
    const text = JSON.stringify(catalog);
    expect(text).not.toMatch(/bde\.config\.yml/);
    expect(text).not.toMatch(/\.env\b/);
  });
});

describe('the two languages', () => {
  it('have the same codes and the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const flat = (node: unknown, path = ''): Record<string, string> =>
      typeof node === 'string'
        ? { [path]: node }
        : Object.entries(node as object).reduce(
            (all, [key, value]) => ({ ...all, ...flat(value, path ? `${path}.${key}` : key) }),
            {},
          );
    const a = flat(fr.setup);
    const b = flat(en.setup);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const key of Object.keys(a)) {
      expect(placeholders(a[key] as string), key).toEqual(placeholders(b[key] as string));
    }
  });
});
