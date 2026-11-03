// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ logoPath: '/logo.svg', name: 'BDE Nice' }));
vi.mock('@/config', () => ({
  getConfig: () => ({
    bde: { name: mocks.name, logoPath: mocks.logoPath, accentColor: '#2F5BEA' },
  }),
}));

const { GET } = await import('./route');

beforeEach(() => {
  mocks.logoPath = '/logo.svg';
  mocks.name = 'BDE Nice';
});

type Manifest = {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  theme_color: string;
  icons: { src: string; sizes: string }[];
};
const manifest = async () => (await GET().json()) as Manifest;

describe('GET /api/manifest', () => {
  it('is the name of the BDE and its icons, and nothing a member would see', async () => {
    const body = await manifest();
    expect(body).toMatchObject({ name: 'BDE Nice', start_url: '/', display: 'standalone' });
    expect(body.icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', purpose: 'any' },
    ]);
    expect(body.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    // only what the login page shows to a visitor
    expect(Object.keys(body).sort()).toEqual(
      [
        'background_color',
        'display',
        'icons',
        'name',
        'scope',
        'short_name',
        'start_url',
        'theme_color',
      ].sort(),
    );
  });

  it('follows the logo of the BDE by its version, and the name at once', async () => {
    mocks.logoPath = '/api/logo?v=0123456789abcdef';
    mocks.name = 'Bureau des étudiants de Nice Sophia';
    const body = await manifest();
    expect(body.icons.map((icon) => icon.src)).toEqual([
      '/api/logo/icon/192?v=0123456789abcdef',
      '/api/logo/icon/512?v=0123456789abcdef',
    ]);
    expect(body.name).toBe('Bureau des étudiants de Nice Sophia');
    expect(body.short_name.length).toBeLessThanOrEqual(12);
  });

  it('is sent as a manifest, asked to be checked again, and not as something a browser could take for a page', () => {
    const response = GET();
    expect(response.headers.get('content-type')).toContain('application/manifest+json');
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
