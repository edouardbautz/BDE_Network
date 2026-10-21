// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/public-address', () => ({ publicOrigin: () => 'http://localhost:3000' }));

const { atPublicOrigin, isUsableCallbackUrl } = await import('./public-request');

const requestAt = (address: string) => new NextRequest(address);

describe('isUsableCallbackUrl (what Auth.js accepts, so that it never answers a 500 for it)', () => {
  it.each([
    '/fr/dashboard',
    '/',
    'http://localhost:3000/fr',
    'https://example.org/somewhere',
    'https:evil.example',
  ])('reads %s', (value) => {
    expect(isUsableCallbackUrl(value, 'http://localhost:3000')).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    '%2f%2fevil.example',
    '',
    'not a url',
    'ftp://x',
  ])('does not read %s', (value) => {
    expect(isUsableCallbackUrl(value, 'http://localhost:3000')).toBe(false);
  });
});

describe('atPublicOrigin', () => {
  it('moves the request to the public address', () => {
    const moved = atPublicOrigin(
      requestAt('http://0.0.0.0:3000/api/auth/callback/42-school?code=x'),
    );
    expect(moved.nextUrl.origin).toBe('http://localhost:3000');
    expect(moved.nextUrl.pathname).toBe('/api/auth/callback/42-school');
    expect(moved.nextUrl.searchParams.get('code')).toBe('x');
  });

  it('returns the very same request when nothing is to change', () => {
    const request = requestAt(
      'http://localhost:3000/api/auth/signin?callbackUrl=%2Ffr%2Fdashboard',
    );
    expect(atPublicOrigin(request)).toBe(request);
  });

  it.each(['javascript:alert(1)', '%2f%2fevil.example', 'data:text/html,x'])(
    'drops a callbackUrl Auth.js would refuse with a server error: %s',
    (value) => {
      const query = `callbackUrl=${encodeURIComponent(value)}&code=x`;
      for (const origin of ['http://localhost:3000', 'http://0.0.0.0:3000']) {
        const moved = atPublicOrigin(requestAt(`${origin}/api/auth/callback/42-school?${query}`));
        expect(moved.nextUrl.searchParams.has('callbackUrl')).toBe(false);
        expect(moved.nextUrl.searchParams.get('code')).toBe('x');
        expect(moved.nextUrl.origin).toBe('http://localhost:3000');
      }
    },
  );

  it('keeps a callbackUrl it can read (where it leads is Auth.js’s rule)', () => {
    const moved = atPublicOrigin(
      requestAt('http://0.0.0.0:3000/api/auth/signin?callbackUrl=https%3A%2F%2Fevil.example'),
    );
    expect(moved.nextUrl.searchParams.get('callbackUrl')).toBe('https://evil.example');
  });

  it('keeps the method and the body of a POST', async () => {
    const request = new NextRequest(
      'http://0.0.0.0:3000/api/auth/signout?callbackUrl=javascript%3Aalert(1)',
      {
        method: 'POST',
        body: 'csrfToken=abc',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    );
    const moved = atPublicOrigin(request);
    expect(moved.method).toBe('POST');
    expect(await moved.text()).toBe('csrfToken=abc');
  });
});
