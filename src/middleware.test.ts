// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setup: false, intl: vi.fn() }));

vi.mock('@/lib/setup/guard', () => ({ isSetupMode: () => mocks.setup }));
vi.mock('next-intl/middleware', () => ({ default: () => mocks.intl }));

const { default: middleware, config } = await import('./middleware');

const request = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => {
  mocks.setup = false;
  mocks.intl.mockReset();
  mocks.intl.mockReturnValue(new NextResponse('intl'));
});

describe('which requests the middleware sees', () => {
  // The matcher is compiled by Next.js as a regular expression: a lost backslash once made it see only "/".
  const sees = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it.each([
    '/',
    '/fr',
    '/en/dashboard',
    '/fr/setup',
    '/api/health',
    '/api/auth/session',
    '/api/events/1/ics',
  ])('sees %s', (path) => {
    expect(sees(path)).toBe(true);
  });

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/favicon.ico',
    '/logo.svg',
    '/robots.txt',
  ])('does not see %s', (path) => {
    expect(sees(path)).toBe(false);
  });
});

describe('an installed platform', () => {
  it('routes the pages through next-intl and lets the API alone', async () => {
    const page = await middleware(request('/fr/dashboard'));
    expect(await page.text()).toBe('intl');
    expect(mocks.intl).toHaveBeenCalledTimes(1);

    const api = await middleware(request('/api/auth/session'));
    expect(api.status).toBe(200);
    expect(mocks.intl).toHaveBeenCalledTimes(1);
  });
});

describe('before the platform is installed', () => {
  beforeEach(() => {
    mocks.setup = true;
  });

  it.each([
    ['/', '/fr/setup'],
    ['/fr', '/fr/setup'],
    ['/fr/dashboard', '/fr/setup'],
    ['/en', '/en/setup'],
    ['/en/members?x=1', '/en/setup'],
    ['/zz/anything', '/fr/setup'],
  ])('sends %s to the installer, on the host the visitor used', async (path, target) => {
    const response = await middleware(request(path));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`http://localhost:3000${target}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.intl).not.toHaveBeenCalled();
  });

  it.each(['/fr/setup', '/en/setup', '/fr/setup/'])(
    'lets the installer %s through',
    async (path) => {
      const response = await middleware(request(path));
      expect(await response.text()).toBe('intl');
    },
  );

  it('does not take a page that merely starts like it for the installer', async () => {
    for (const path of ['/fr/setupx', '/fr/members/setup', '/setup']) {
      expect((await middleware(request(path))).status).toBe(307);
    }
  });

  it('closes the API (503), but for the health check', async () => {
    for (const path of [
      '/api/auth/session',
      '/api/auth/callback/42-school',
      '/api/calendar/abc',
      '/api/me/export',
    ]) {
      const response = await middleware(request(path));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'not-installed' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect((await middleware(request('/api/health'))).status).toBe(200);
  });
});
