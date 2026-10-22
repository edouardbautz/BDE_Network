// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The platform serves its own font and makes no request to Google when it runs. Manrope is loaded with `next/font`, which
 * downloads the file when the image is built and serves it from the platform; the content policy forbids any other host for a font.
 * `qa/browsers/self-hosted.spec.ts` plays it in a browser; this holds the source.
 */
const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the font of the platform', () => {
  it('is Manrope, loaded by next/font (downloaded at the build, never at run time), and no other', () => {
    const layout = source('src/app/[locale]/layout.tsx');
    expect(layout).toMatch(/import \{ Manrope \} from 'next\/font\/google'/);
    expect(layout).not.toMatch(/Geist/);
    expect(layout).toMatch(/variable: '--font-manrope'/);
    expect(source('src/app/globals.css')).toMatch(/--font-sans:\s*var\(--font-manrope\)/);
  });

  it('is never fetched from a font host by a stylesheet link, an @import or a script', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', 'src', 'docker', 'public', 'next.config.ts', 'Dockerfile'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter((file) => /\.(tsx?|css|mjs|js|html|svg|ts)$/.test(file) || file === 'Dockerfile');
    const offenders = tracked.filter((file) =>
      /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit|cdnjs\.cloudflare|unpkg\.com|cdn\.jsdelivr/.test(
        source(file),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('is allowed from the platform alone by the content policy, like every script, image source and connection', () => {
    const policy = source('src/lib/security-headers.ts');
    expect(policy).toContain(`"font-src 'self'"`);
    expect(policy).toContain(`"connect-src 'self'"`);
    expect(policy).toContain(`"default-src 'self'"`);
  });
});
