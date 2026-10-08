// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLogoVersion,
  logoPathFor,
  logoVersionOf,
  pruneLogos,
  readLogo,
  saveLogo,
  uploadsDir,
} from './storage';

const png = (w: number, h: number, extra = 0) => {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bde-uploads-'));
  vi.stubEnv('UPLOADS_DIR', join(dir, 'nested', 'uploads'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('the logo on disk', () => {
  it('stores a checked image under a name made of its content, and reads it back', async () => {
    const bytes = png(256, 256);
    const saved = await saveLogo(bytes);
    expect(saved).toMatchObject({ ok: true, info: { mime: 'image/png' } });
    if (!saved.ok) return;
    expect(isLogoVersion(saved.version)).toBe(true);
    expect(await readLogo(saved.version)).toEqual(Buffer.from(bytes));
    // the same image is the same version; another image is another one
    expect(await saveLogo(bytes)).toMatchObject({ version: saved.version });
    expect(await saveLogo(png(300, 300))).not.toMatchObject({ version: saved.version });
  });

  it('writes nothing for a file that is not an acceptable logo', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await saveLogo(svg)).toEqual({ ok: false, code: 'logoFormat' });
    expect(await saveLogo(png(10, 10))).toEqual({ ok: false, code: 'logoSmall' });
    await expect(readdir(uploadsDir())).rejects.toThrow();
  });

  it('leaves no temporary file behind', async () => {
    await saveLogo(png(256, 256));
    expect((await readdir(uploadsDir())).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reads nothing for a version that is not one (no path can be walked), or that is not there', async () => {
    expect(await readLogo('../../etc/passwd')).toBeNull();
    expect(await readLogo('0123456789abcdef')).toBeNull();
    expect(await readLogo('')).toBeNull();
  });

  it('cannot be made to read another file of the folder (or above it) through its version', async () => {
    await mkdir(uploadsDir(), { recursive: true });
    await writeFile(join(uploadsDir(), 'secret.txt'), 'not a logo');
    // `logo-x/../secret.txt` is, for the file system, `secret.txt`
    expect(await readLogo('x/../secret.txt')).toBeNull();
    expect(await readLogo('..')).toBeNull();
  });

  it('keeps one logo and removes the others', async () => {
    const first = await saveLogo(png(256, 256));
    const second = await saveLogo(png(300, 300));
    if (!first.ok || !second.ok) throw new Error('not saved');
    await writeFile(join(uploadsDir(), 'unrelated.txt'), 'x');

    await pruneLogos(second.version);
    expect(await readLogo(first.version)).toBeNull();
    expect(await readLogo(second.version)).not.toBeNull();
    expect(await readdir(uploadsDir())).toContain('unrelated.txt');

    await pruneLogos(null);
    expect(await readLogo(second.version)).toBeNull();
  });

  it('pruning before there is a folder is harmless', async () => {
    await expect(pruneLogos(null)).resolves.toBeUndefined();
  });
});

describe('the address of a logo', () => {
  it('carries the version, and gives it back', () => {
    expect(logoPathFor('0123456789abcdef')).toBe('/api/logo?v=0123456789abcdef');
    expect(logoVersionOf('/api/logo?v=0123456789abcdef')).toBe('0123456789abcdef');
  });

  it('knows no version in the default logo or anything else', () => {
    expect(logoVersionOf('/logo.svg')).toBeNull();
    expect(logoVersionOf('/api/logo?v=../../x')).toBeNull();
    expect(logoVersionOf('/api/logo')).toBeNull();
  });
});
