// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A character written as a `\uXXXX` escape through a terminal loses its backslash (and sometimes the `u`): "d'une"
 * became "d2019une" in a message people read. Characters are written directly in every text (see "Writing texts" in
 * docs/architecture.md). This test finds what is left of such an escape in a text that is displayed: the catalogs of
 * messages, the documentation, the notification references and the sources (a real year such as 2019 is not one:
 * the signature is a word of letters with the code stuck inside it).
 */

const ROOT = join(__dirname, '..', '..');

// The code points of the characters a text is likely to hold: apostrophes, quotes, dashes, spaces, ellipsis, accents.
const CODES =
  '00a0|00ab|00bb|00b0|00b7|00c0|00c7|00c9|00d7|00e0|00e2|00e7|00e8|00e9|00ea|00eb|00ee|00ef|00f4|00f9|00fb|' +
  '2010|2011|2012|2013|2014|2018|2019|201c|201d|2022|2026|202f|2192|2212|20ac';

/** A word of letters with a code inside it, `u` kept or lost (`d2019une`, `du2019une`, `tr00e8s`), not made of hex digits only. */
const LOST_BACKSLASH = new RegExp(
  `(?<![\\p{L}\\p{N}])(?!P\\d{4}(?![\\p{L}\\p{N}]))(?![0-9a-f]+(?![\\p{L}\\p{N}]))[\\p{L}]+(?:${CODES})(?![0-9a-f])[\\p{L}]*`,
  'giu',
);
/** The escape itself, written as text (`\\u2019` in a catalog or a page of documentation). */
const ESCAPE_AS_TEXT = /\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/;

function brokenEscapes(text: string): string[] {
  return [...text.matchAll(LOST_BACKSLASH)].map((m) => m[0]);
}

function walk(dir: string, accepts: (path: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      ['node_modules', '.next', '.git', 'generated', 'coverage', 'test-results'].includes(
        entry.name,
      )
    )
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, accepts, found);
    else if (accepts(path)) found.push(path);
  }
  return found;
}

function values(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((item) => values(item, out));
  else if (node && typeof node === 'object')
    Object.values(node).forEach((item) => values(item, out));
  return out;
}

const rel = (path: string) => relative(ROOT, path).replaceAll('\\', '/');

describe('no broken escape in a displayed text', () => {
  it('knows what it looks for', () => {
    expect(brokenEscapes('Ce canal partira d2019une copie')).toEqual(['d2019une']);
    expect(ESCAPE_AS_TEXT.test('d\\u2019une')).toBe(true);
    expect(ESCAPE_AS_TEXT.test('a \\x41 b')).toBe(true);
    expect(ESCAPE_AS_TEXT.test('Unicode, u2019 et x41')).toBe(false);
    expect(brokenEscapes('du2019une, tr00e8s, l2026')).toEqual(['du2019une', 'tr00e8s', 'l2026']);
    expect(
      brokenEscapes('Les statistiques de 2019, la version 2026, le 2019-2020, abc2019'),
    ).toEqual([]);
    expect(brokenEscapes('id a1b2c3d4 deadbeef00e9 2019 P2012 P2014')).toEqual([]);
    expect(brokenEscapes("Ce canal partira d'une copie… « ok »")).toEqual([]);
  });

  it('is clean in the catalogs of messages (and holds no escape written as text)', () => {
    for (const file of walk(join(ROOT, 'messages'), (p) => p.endsWith('.json'))) {
      for (const text of values(JSON.parse(readFileSync(file, 'utf8')))) {
        expect(brokenEscapes(text), rel(file)).toEqual([]);
        expect(ESCAPE_AS_TEXT.test(text), `${rel(file)}: ${text.slice(0, 60)}`).toBe(false);
      }
    }
  });

  it('is clean in the documentation, the changelog and the references of the notifications', () => {
    const files = walk(
      ROOT,
      (p) =>
        /\.(md|yml|yaml)$/.test(p) ||
        (/__golden__/.test(p) && p.endsWith('.json')) ||
        p.endsWith('.txt'),
    ).filter(
      (p) =>
        rel(p) !== 'docs/architecture.md' &&
        !rel(p).startsWith('e2e/') &&
        !rel(p).startsWith('qa/browsers/.visual'),
    );
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(brokenEscapes(text), rel(file)).toEqual([]);
      if (!/\.json$/.test(file)) expect(ESCAPE_AS_TEXT.test(text), rel(file)).toBe(false);
    }
  });

  it('is clean in the sources (defaults of the notifications, pages, mails)', () => {
    const files = walk(join(ROOT, 'src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      expect(brokenEscapes(readFileSync(file, 'utf8')), rel(file)).toEqual([]);
    }
  });
});
