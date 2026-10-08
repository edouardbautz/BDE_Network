// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ logoPath: '/logo.svg' }));
vi.mock('@/config', () => ({ getConfig: () => ({ bde: { logoPath: mocks.logoPath } }) }));

const { saveLogo, uploadsDir } = await import('@/lib/branding/storage');
const { GET } = await import('./route');

const png = () => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 256);
  new DataView(b.buffer).setUint32(20, 256);
  return b;
};

const call = (query = '') => GET(new Request(`https://bde.example/api/logo${query}`));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bde-logo-route-'));
  vi.stubEnv('UPLOADS_DIR', dir);
  mocks.logoPath = '/logo.svg';
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/logo', () => {
  it('serves the logo of the version asked, as an image that cannot be taken for a page', async () => {
    const saved = await saveLogo(png());
    if (!saved.ok) throw new Error('not saved');

    const response = await call(`?v=${saved.version}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('etag')).toBe(`"${saved.version}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png());
  });

  it('serves, without a version, the one the settings point to', async () => {
    const saved = await saveLogo(png());
    if (!saved.ok) throw new Error('not saved');
    mocks.logoPath = `/api/logo?v=${saved.version}`;

    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
  });

  it('answers 404 when the BDE has no logo of its own, or the version is not there', async () => {
    expect((await call()).status).toBe(404);
    expect((await call('?v=0123456789abcdef')).status).toBe(404);
  });

  it('never walks out of the folder, whatever the version says', async () => {
    expect((await call('?v=../../../etc/passwd')).status).toBe(404);
    expect((await call('?v=%2e%2e%2f%2e%2e%2fsecrets')).status).toBe(404);
  });

  it('serves nothing that is not an image, even under a good name', async () => {
    const version = '0123456789abcdef';
    await writeFile(join(uploadsDir(), `logo-${version}`), '<script>alert(1)</script>');
    expect((await call(`?v=${version}`)).status).toBe(404);
  });
});
