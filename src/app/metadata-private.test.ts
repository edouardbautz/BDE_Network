// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The platform is private, and what a page says about itself in its head is read by anybody who is given its address (a chat unfolds a link,
 * a crawler reads it): the title of an event, the name of a member, anything a page shows to a member must not get there. So the head of every
 * page is **static**: a message of the catalog (`pageTitle`), or the BDE's own facts (`brandMetadata`, in the layout). A page that wants its head
 * to say something that comes from the database goes through this list, and the list is a decision.
 */

const ROOT = join(__dirname);

function files(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(path) && !/\.test\./.test(path)) found.push(path);
  }
  return found;
}

/** The files that build a head of their own, with what each is allowed to put in it. */
const OWN_HEAD = new Map<string, string>([
  ['[locale]/layout.tsx', 'the BDE’s name, its logo and one generic sentence (brandMetadata)'],
  ['[locale]/setup/page.tsx', 'the installer, which has no member and no data'],
  ['[locale]/unavailable/page.tsx', 'a sentence of the catalog'],
]);

describe('the head of the pages', () => {
  const sources = files(ROOT).map(
    (path) => [relative(ROOT, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')] as const,
  );

  it('reads the pages it is about', () => {
    expect(sources.length).toBeGreaterThan(60);
  });

  it('is built from the catalog or from the BDE’s facts: no page writes a title or a preview of its own', () => {
    const found = sources
      .filter(([, text]) => /\bgenerateMetadata\b|\bexport const metadata\b/.test(text))
      .filter(
        ([name, text]) =>
          !OWN_HEAD.has(name) && !/export const generateMetadata = pageTitle\(/.test(text),
      )
      .map(([name]) => name);
    expect(found).toEqual([]);
  });

  it('keeps those that build one from reading anything of a member: no query, no session', () => {
    for (const name of OWN_HEAD.keys()) {
      const text = sources.find(([source]) => source === name)?.[1] ?? '';
      const head = text.slice(text.search(/generateMetadata/));
      const block = head.slice(0, head.indexOf('\n}\n') + 3);
      expect(block, name).not.toMatch(/prisma|getEffectiveSession|requireApprovedSession|auth\(\)/);
    }
  });

  it('never gives a page a preview of its own: nothing but the layout writes `openGraph` or `twitter`', () => {
    const found = sources
      .filter(
        ([name, text]) =>
          /\bopenGraph\b|\btwitter\s*:/.test(text) && name !== '[locale]/layout.tsx',
      )
      .map(([name]) => name);
    expect(found).toEqual([]);
  });
});
