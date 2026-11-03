// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ logoPath: '/logo.svg' }));
vi.mock('@/config', () => ({ getConfig: () => ({ bde: { logoPath: mocks.logoPath } }) }));

const { saveLogo } = await import('@/lib/branding/storage');
const { GET } = await import('./route');

const png = (width: number, height = width) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
};

const call = (size: string, query = '') =>
  GET(new Request(`https://bde.example/api/logo/icon/${size}${query}`), {
    params: Promise.resolve({ size }),
  });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bde-icon-route-'));
  vi.stubEnv('UPLOADS_DIR', dir);
  mocks.logoPath = '/logo.svg';
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/logo/icon/<size>', () => {
  it('serves the icon the browser drew, as an image that cannot be taken for a page, cached for good by its version', async () => {
    const saved = await saveLogo(png(300), { 192: png(192) });
    if (!saved.ok) throw new Error('not saved');

    const response = await call('192', `?v=${saved.version}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(192));
  });

  it('serves the logo itself for a size that was not drawn (a logo sent before the icons existed)', async () => {
    const saved = await saveLogo(png(300));
    if (!saved.ok) throw new Error('not saved');
    const response = await call('48', `?v=${saved.version}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(300));
  });

  it('serves, without a version, the logo the settings point to now, and asks to be checked again', async () => {
    const saved = await saveLogo(png(300), { 180: png(180) });
    if (!saved.ok) throw new Error('not saved');
    mocks.logoPath = `/api/logo?v=${saved.version}`;
    const response = await call('180');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(180));
  });

  it('is a 404 while the BDE has no logo of its own (the pages point at the files of the platform then), for a size that is not one, and for a version that is not there', async () => {
    expect((await call('192')).status).toBe(404);
    const saved = await saveLogo(png(300), { 192: png(192) });
    if (!saved.ok) throw new Error('not saved');
    for (const size of ['999', '0', '..', '../logo', '192.png', '']) {
      const response = await call(size, `?v=${saved.version}`);
      expect(response.status, size).toBe(404);
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    }
    expect((await call('192', '?v=0000000000000000')).status).toBe(404);
    expect((await call('192', '?v=../../etc/passwd')).status).toBe(404);
  });
});
