// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkIcon, ICON_MAX_BYTES, ICON_SIZES, iconSizeOf } from './icons';
import { fitInSquare } from './draw-icons';
import { brandMetadata, iconPath } from './icon-links';
import { pruneLogos, readIcon, readLogo, saveLogo, uploadsDir } from './storage';

const png = (width: number, height = width, extra = 0) => {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
};

describe('the sizes of the icons', () => {
  it('are the ones the platform needs: the tab, an iPhone, the manifest', () => {
    expect(ICON_SIZES).toEqual([48, 180, 192, 512]);
  });

  it('are read from an address only when they are one of those', () => {
    expect(iconSizeOf('192')).toBe(192);
    for (const bad of ['', '0', '47', '999', '192x', '../192', '1e2', '0192', '-192', '512 ']) {
      expect(iconSizeOf(bad)).toBeNull();
    }
  });

  it('accept a PNG of exactly the size, and refuse anything else', () => {
    expect(checkIcon(png(48), 48)).toBe(true);
    expect(checkIcon(png(48), 192)).toBe(false); // the wrong size
    expect(checkIcon(png(48, 40), 48)).toBe(false); // not square
    expect(
      checkIcon(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 48),
    ).toBe(false);
    expect(checkIcon(new Uint8Array(0), 48)).toBe(false);
    expect(checkIcon(png(48, 48, ICON_MAX_BYTES), 48)).toBe(false); // too heavy
    // a JPEG of the right size is not a PNG
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 48, 0, 48, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    ]);
    expect(checkIcon(jpeg, 48)).toBe(false);
  });
});

describe('where the logo goes in an icon', () => {
  it('is the biggest that fits, centred, with a margin, and never stretched', () => {
    expect(fitInSquare(100, 100, 100)).toEqual({ x: 8, y: 8, width: 84, height: 84 });
    const wide = fitInSquare(400, 100, 192);
    expect(wide.width / wide.height).toBeCloseTo(4, 1);
    expect(wide.x).toBe(Math.round((192 - wide.width) / 2));
    expect(wide.y).toBe(Math.round((192 - wide.height) / 2));
    const tall = fitInSquare(100, 400, 192);
    expect(tall.height / tall.width).toBeCloseTo(4, 1);
    for (const at of [wide, tall]) {
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + at.width).toBeLessThanOrEqual(192);
      expect(at.y + at.height).toBeLessThanOrEqual(192);
    }
  });
});

describe('the icons on disk', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bde-icons-'));
    vi.stubEnv('UPLOADS_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('are stored next to the logo of the version they were drawn from, and read back', async () => {
    const saved = await saveLogo(png(300), { 48: png(48), 192: png(192), 512: png(512) });
    if (!saved.ok) throw new Error('not saved');
    expect(await readIcon(saved.version, 48)).toEqual(Buffer.from(png(48)));
    expect(await readIcon(saved.version, 512)).toEqual(Buffer.from(png(512)));
    expect(await readIcon(saved.version, 180)).toBeNull(); // not sent: the logo itself is used
    expect((await readdir(uploadsDir())).sort()).toEqual(
      [
        `logo-${saved.version}`,
        ...[192, 48, 512].map((size) => `logo-${saved.version}.${size}`),
      ].sort(),
    );
  });

  it('are dropped, never an error, when they are not what they say: the logo is saved all the same', async () => {
    const saved = await saveLogo(png(300), { 48: png(64), 192: new Uint8Array([1, 2, 3]) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(await readIcon(saved.version, 48)).toBeNull();
    expect(await readIcon(saved.version, 192)).toBeNull();
    expect(await readLogo(saved.version)).not.toBeNull();
  });

  it('read nothing for a version that is not one, or a size that is not there', async () => {
    expect(await readIcon('../../etc/passwd', 48)).toBeNull();
    expect(await readIcon('0123456789abcdef', 48)).toBeNull();
  });

  it('go with their logo: pruning keeps the icons of the logo kept and removes those of the others', async () => {
    const first = await saveLogo(png(300), { 48: png(48) });
    const second = await saveLogo(png(400), { 48: png(48), 192: png(192) });
    if (!first.ok || !second.ok) throw new Error('not saved');
    await pruneLogos(second.version);
    expect(await readIcon(first.version, 48)).toBeNull();
    expect(await readIcon(second.version, 48)).not.toBeNull();
    expect(await readIcon(second.version, 192)).not.toBeNull();
    await pruneLogos(null);
    expect(await readdir(uploadsDir())).toEqual([]);
  });
});

describe('what a page says about itself', () => {
  const brand = {
    name: 'BDE Nice',
    description: 'Plateforme de gestion du BDE Nice',
    locale: 'fr_FR',
    logoVersion: null as string | null,
    origin: 'https://bde.example.fr' as string | null,
  };

  it('points at the files of the platform while the BDE has no logo of its own', () => {
    expect(iconPath(48, null)).toBe('/icons/icon-48.png');
    const metadata = brandMetadata(brand);
    expect(metadata.icons).toEqual({
      icon: [
        { url: '/icons/icon-48.png', sizes: '48x48' },
        { url: '/icons/icon-192.png', sizes: '192x192' },
      ],
      apple: [{ url: '/icons/icon-180.png', sizes: '180x180' }],
    });
    expect(metadata.manifest).toBe('/api/manifest');
  });

  it('points at the BDE’s own logo, by its version, as soon as it has one', () => {
    const metadata = brandMetadata({ ...brand, logoVersion: '0123456789abcdef' });
    expect(JSON.stringify(metadata.icons)).toContain('/api/logo/icon/48?v=0123456789abcdef');
    expect(JSON.stringify(metadata.icons)).toContain('/api/logo/icon/180?v=0123456789abcdef');
    expect(metadata.manifest).toBe('/api/manifest?v=0123456789abcdef');
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: 'https://bde.example.fr/api/logo/icon/512?v=0123456789abcdef' }],
    });
  });

  it('is, for a link, the name of the BDE, one generic sentence and the logo, and nothing else', () => {
    const metadata = brandMetadata(brand);
    expect(metadata.openGraph).toEqual({
      type: 'website',
      siteName: 'BDE Nice',
      title: 'BDE Nice',
      description: 'Plateforme de gestion du BDE Nice',
      locale: 'fr_FR',
      images: [
        {
          url: 'https://bde.example.fr/icons/icon-512.png',
          width: 512,
          height: 512,
          alt: 'BDE Nice',
        },
      ],
    });
    expect(metadata.twitter).toEqual({
      card: 'summary',
      title: 'BDE Nice',
      description: 'Plateforme de gestion du BDE Nice',
      images: ['https://bde.example.fr/icons/icon-512.png'],
    });
  });

  it('asks for no image it cannot give an address to: a preview needs an absolute one', () => {
    const metadata = brandMetadata({ ...brand, origin: null });
    expect(metadata.openGraph).not.toHaveProperty('images');
    expect(metadata.twitter).not.toHaveProperty('images');
    expect(metadata).not.toHaveProperty('metadataBase');
  });
});
