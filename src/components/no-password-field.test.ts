// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No field of this platform is of the type `password`, and none asks for `new-password` or `current-password`: a browser then has
 * no login to fill nor to save, whatever it has stored of other sites. A secret is typed in a `MaskedInput` (a text field drawn as
 * dots) and shown, once saved, as "Configured" (`components/secret-field.tsx`). A field that is of the type `password` brings back
 * the incident that made this: the first field before it (the user of the mail server) filled with an address of another site, and
 * a saved password put in the webhook of Discord.
 */

const ROOT = join(__dirname, '..');

function files(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'generated'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, found);
    else if (/\.tsx$/.test(path) && !/\.test\./.test(path)) found.push(path);
  }
  return found;
}

describe('the fields of the platform', () => {
  const sources = files(ROOT).map(
    (path) => [relative(ROOT, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')] as const,
  );

  it('reads the components it is about', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('are never of the type password', () => {
    const found = sources
      .filter(([, text]) => /type=(?:"password"|'password'|\{['"]password['"]\})/.test(text))
      .map(([name]) => name);
    expect(found).toEqual([]);
  });

  it('never ask a browser to generate or fill a password', () => {
    const found = sources
      .filter(([, text]) => /autoComplete=(?:"|\{['"])(?:new|current)-password/.test(text))
      .map(([name]) => name);
    expect(found).toEqual([]);
  });
});
