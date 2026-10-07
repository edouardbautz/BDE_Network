// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchCampuses } from './campus-search';
import { checkLogin, listCampuses, verifyCredentials, type FetchLike } from './fortytwo';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const noWait = async () => undefined;

describe('verifyCredentials', () => {
  it('returns a token for a valid pair, asking with the client credentials flow and the secret in the body only', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return json({ access_token: 'token-123' });
    };

    await expect(verifyCredentials(fetchFn, 'u-s4t2ud-good', 's-s4t2ud-secret')).resolves.toEqual({
      ok: true,
      token: 'token-123',
    });
    expect(calls[0]?.url).toBe('https://api.intra.42.fr/oauth/token');
    expect(calls[0]?.url).not.toContain('s-s4t2ud-secret');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init?.body)))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'u-s4t2ud-good',
      client_secret: 's-s4t2ud-secret',
    });
  });

  it.each([
    [401, { ok: false, reason: 'invalid' }],
    [400, { ok: false, reason: 'invalid' }],
    [429, { ok: false, reason: 'rate-limited' }],
    [503, { ok: false, reason: 'unexpected', status: 503 }],
  ])('answers %i as %j', async (status, expected) => {
    await expect(verifyCredentials(async () => json({}, status), 'id', 'secret')).resolves.toEqual(
      expected,
    );
  });

  it('does not take a success without a token for one', async () => {
    await expect(verifyCredentials(async () => json({}), 'id', 'secret')).resolves.toEqual({
      ok: false,
      reason: 'unexpected',
      status: 200,
    });
  });

  it('says what kind of network failure, and nothing that was sent', async () => {
    const failing: FetchLike = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    };
    await expect(verifyCredentials(failing, 'u-id', 's-the-secret')).resolves.toEqual({
      ok: false,
      reason: 'network',
      detail: 'ENOTFOUND',
    });
  });

  describe('FORTYTWO_API_URL (the stand-in server of the end-to-end tests)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('replaces the address of the 42 API', async () => {
      vi.stubEnv('FORTYTWO_API_URL', 'http://mock.local:4242/');
      const urls: string[] = [];
      await verifyCredentials(
        async (url) => {
          urls.push(url);
          return json({ access_token: 't' });
        },
        'id',
        'secret',
      );
      expect(urls).toEqual(['http://mock.local:4242/oauth/token']);
    });
  });
});

describe('listCampuses', () => {
  const row = (id: number, name: string) => ({
    id,
    name,
    country: 'France',
    time_zone: 'Europe/Paris',
  });

  it('sorts the campuses by name and keeps their time zone', async () => {
    const campuses = await listCampuses(
      async () => json([row(2, 'Nice'), row(1, 'Angoulême'), { id: 3, name: '  ' }, { nope: 1 }]),
      'token',
      noWait,
    );
    expect(campuses?.map((campus) => campus.name)).toEqual(['Angoulême', 'Nice']);
    expect(campuses?.[0]?.timeZone).toBe('Europe/Paris');
  });

  it('reads every page, politely', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => row(index, `Campus ${index}`));
    const sleeps: number[] = [];
    const requested: string[] = [];
    const campuses = await listCampuses(
      async (url) => {
        requested.push(url);
        return json(url.includes('number%5D=1') ? page1 : [row(500, 'Last')]);
      },
      'token',
      async (ms) => void sleeps.push(ms),
    );
    expect(campuses).toHaveLength(101);
    expect(requested).toHaveLength(2);
    expect(sleeps).toEqual([600]);
  });

  it('waits out a rate limit, then goes on', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const campuses = await listCampuses(
      async () => (++calls === 1 ? json({}, 429, { 'Retry-After': '2' }) : json([row(1, 'Nice')])),
      'token',
      async (ms) => void sleeps.push(ms),
    );
    expect(campuses).toHaveLength(1);
    expect(sleeps).toEqual([2000]);
  });

  it('gives null when 42 cannot answer', async () => {
    expect(await listCampuses(async () => json({}, 500), 'token', noWait)).toBeNull();
    expect(
      await listCampuses(
        async () => {
          throw new Error('offline');
        },
        'token',
        noWait,
      ),
    ).toBeNull();
    expect(await listCampuses(async () => json({ not: 'a list' }), 'token', noWait)).toBeNull();
  });
});

describe('checkLogin', () => {
  it('tells an existing login from a missing one', async () => {
    expect(await checkLogin(async () => json({ login: 'alice' }), 'token', 'alice', noWait)).toBe(
      'exists',
    );
    expect(await checkLogin(async () => json({}, 404), 'token', 'nobody', noWait)).toBe('missing');
  });

  it('asks for the login encoded, with the token in a header', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await checkLogin(
      async (url, init) => {
        seen.push({ url, init });
        return json({ login: 'x' });
      },
      'the-token',
      'a/b?c',
      noWait,
    );
    expect(seen[0]?.url).toBe('https://api.intra.42.fr/v2/users/a%2Fb%3Fc');
    expect((seen[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer the-token',
    );
  });

  it('does not guess when 42 does not answer', async () => {
    expect(await checkLogin(async () => json({}, 500), 'token', 'alice', noWait)).toBe('unknown');
    expect(
      await checkLogin(
        async () => {
          throw new Error('offline');
        },
        'token',
        'alice',
        noWait,
      ),
    ).toBe('unknown');
    expect(await checkLogin(async () => json({}, 429), 'token', 'alice', noWait)).toBe('unknown');
  });
});

describe('searchCampuses', () => {
  const campuses = [
    { name: 'Nice' },
    { name: 'Montréal' },
    { name: 'Le Havre' },
    { name: 'Paris' },
  ];

  it('ignores accents and case, best matches (the start of the name) first', () => {
    expect(searchCampuses(campuses, 'montreal').map((campus) => campus.name)).toEqual(['Montréal']);
    // the names that START with the search come before those that merely contain it
    const names = [{ name: 'Le Mans' }, { name: 'Mans' }, { name: 'Amanson' }];
    expect(searchCampuses(names, 'man').map((campus) => campus.name)).toEqual([
      'Mans',
      'Amanson',
      'Le Mans',
    ]);
  });
  it('finds nothing for nothing', () => {
    expect(searchCampuses(campuses, '  ')).toEqual([]);
    expect(searchCampuses(campuses, 'zzz')).toEqual([]);
  });
});
