// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  checkLogin,
  fold,
  listCampuses,
  searchCampuses,
  verifyCredentials,
  type Campus,
  type FetchLike,
} from './fortytwo';
import { CAMPUSES, fakeApi } from './test-helpers';

const noWait = async () => undefined;

describe('verifyCredentials', () => {
  it('returns a token when the UID and the secret are a valid pair', async () => {
    const api = fakeApi();
    await expect(verifyCredentials(api.fetch, 'u-s4t2ud-good', 's-s4t2ud-secret')).resolves.toEqual(
      {
        ok: true,
        token: 'token-123',
      },
    );
  });

  it('asks for a token with the client credentials flow, the secret only in the request body', async () => {
    const api = fakeApi();
    await verifyCredentials(api.fetch, 'u-s4t2ud-good', 's-s4t2ud-secret');

    expect(api.requests).toEqual(['POST https://api.intra.42.fr/oauth/token']);
    const body = new URLSearchParams(api.tokenBodies[0]);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'u-s4t2ud-good',
      client_secret: 's-s4t2ud-secret',
    });
    expect(api.requests.join()).not.toContain('s-s4t2ud-secret');
  });

  it('says the credentials are invalid when 42 answers 401 (invalid_client)', async () => {
    const api = fakeApi();
    await expect(verifyCredentials(api.fetch, 'u-s4t2ud-good', 'wrong-secret-1')).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    await expect(verifyCredentials(api.fetch, 'u-unknown-uid', 's-s4t2ud-secret')).resolves.toEqual(
      {
        ok: false,
        reason: 'invalid',
      },
    );
  });

  it('says so when 42 asks to wait (429)', async () => {
    const api = fakeApi({ tokenStatus: 429 });
    await expect(verifyCredentials(api.fetch, 'a', 'b')).resolves.toEqual({
      ok: false,
      reason: 'rate-limited',
    });
  });

  it('reports a server error with its status, not as invalid credentials', async () => {
    const api = fakeApi({ tokenStatus: 503 });
    await expect(verifyCredentials(api.fetch, 'a', 'b')).resolves.toEqual({
      ok: false,
      reason: 'unexpected',
      status: 503,
    });
  });

  it('reports a network failure by its error code only', async () => {
    const api = fakeApi({ down: true });
    await expect(verifyCredentials(api.fetch, 'a', 'b')).resolves.toEqual({
      ok: false,
      reason: 'network',
      detail: 'ENOTFOUND',
    });
  });

  it('does not repeat the secret in the description of a network failure', async () => {
    const leaky: FetchLike = async (_url, init) => {
      throw new Error(`failed with ${String(init?.body)}`);
    };
    const result = await verifyCredentials(leaky, 'u-s4t2ud-good', 's-s4t2ud-secret');
    expect(result).toMatchObject({ ok: false, reason: 'network', detail: 'Error' });
    expect(JSON.stringify(result)).not.toContain('s-s4t2ud-secret');
  });

  it('treats an answer without a token as unexpected', async () => {
    const odd: FetchLike = async () => new Response('{}', { status: 200 });
    await expect(verifyCredentials(odd, 'a', 'b')).resolves.toEqual({
      ok: false,
      reason: 'unexpected',
      status: 200,
    });
    const html: FetchLike = async () => new Response('<html>', { status: 200 });
    await expect(verifyCredentials(html, 'a', 'b')).resolves.toMatchObject({
      ok: false,
      reason: 'unexpected',
    });
  });
});

describe('listCampuses', () => {
  it('lists the campuses with their name, country and time zone, sorted by name', async () => {
    const api = fakeApi({ campuses: CAMPUSES });
    const list = await listCampuses(api.fetch, 'token-123', noWait);

    expect(list?.map((campus) => campus.name)).toEqual([
      'Lyon',
      'Montréal',
      'Nice',
      'Nicosia',
      'Paris',
      'Seoul',
    ]);
    expect(list?.find((campus) => campus.name === 'Nice')).toEqual({
      id: 2,
      name: 'Nice',
      country: 'France',
      timeZone: 'Europe/Paris',
    });
  });

  it('sends the token as a bearer, and asks for pages of 100', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const spy: FetchLike = async (url, init) => {
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      return new Response('[]', { status: 200 });
    };
    await listCampuses(spy, 'token-123', noWait);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toBe('Bearer token-123');
    expect(decodeURIComponent(calls[0]?.url ?? '')).toBe(
      'https://api.intra.42.fr/v2/campus?page[size]=100&page[number]=1',
    );
  });

  it('follows the pages until one is not full, waiting between them', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({
      id: i + 1,
      name: `Campus ${String(i + 1).padStart(3, '0')}`,
    }));
    const api = fakeApi({ campuses: many });
    const sleep = vi.fn(noWait);

    const list = await listCampuses(api.fetch, 'token-123', sleep);

    expect(list).toHaveLength(130);
    expect(api.requests).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(600); // 42 allows two requests a second
  });

  it('skips rows without an id or a name, and trims names', async () => {
    const api = fakeApi({
      campuses: [
        { id: 1, name: '  Paris  ' },
        { id: 2, name: '' },
        { id: 3 } as { id: number; name: string },
        { name: 'Sans id' } as { id: number; name: string },
      ],
    });
    expect((await listCampuses(api.fetch, 'token-123', noWait))?.map((c) => c.name)).toEqual([
      'Paris',
    ]);
  });

  it('leaves the time zone undefined when 42 gives none', async () => {
    const api = fakeApi({ campuses: [{ id: 1, name: 'Paris' }] });
    expect((await listCampuses(api.fetch, 'token-123', noWait))?.[0]?.timeZone).toBeUndefined();
  });

  it('waits and tries again when 42 answers 429', async () => {
    let calls = 0;
    const flaky: FetchLike = async () =>
      ++calls === 1
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
        : new Response(JSON.stringify([{ id: 1, name: 'Paris' }]), { status: 200 });
    const sleep = vi.fn(noWait);

    expect((await listCampuses(flaky, 'token-123', sleep))?.map((c) => c.name)).toEqual(['Paris']);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up with null on a persistent error, a network failure or a strange answer', async () => {
    expect(
      await listCampuses(fakeApi({ campusStatus: 500 }).fetch, 'token-123', noWait),
    ).toBeNull();
    expect(await listCampuses(fakeApi({ down: true }).fetch, 'token-123', noWait)).toBeNull();
    expect(
      await listCampuses(fakeApi({ campusStatus: 429 }).fetch, 'token-123', noWait),
    ).toBeNull();
    const notAList: FetchLike = async () => new Response('{"a":1}', { status: 200 });
    expect(await listCampuses(notAList, 'token-123', noWait)).toBeNull();
    expect(
      await listCampuses(fakeApi({ campuses: CAMPUSES }).fetch, 'wrong-token', noWait),
    ).toBeNull();
  });
});

describe('checkLogin', () => {
  const api = () => fakeApi({ logins: ['jdupont', 'marie-d'] });

  it('says a login exists', async () => {
    expect(await checkLogin(api().fetch, 'token-123', 'jdupont', noWait)).toBe('exists');
  });

  it('says a login does not exist when 42 answers 404', async () => {
    expect(await checkLogin(api().fetch, 'token-123', 'nobody', noWait)).toBe('missing');
  });

  it('puts the login in the path, encoded', async () => {
    const fake = api();
    await checkLogin(fake.fetch, 'token-123', 'a/b?c', noWait);
    expect(fake.requests).toEqual(['GET https://api.intra.42.fr/v2/users/a%2Fb%3Fc']);
  });

  it('cannot tell when the API is down, the token is refused or the answer is odd', async () => {
    expect(await checkLogin(fakeApi({ down: true }).fetch, 'token-123', 'jdupont', noWait)).toBe(
      'unknown',
    );
    expect(await checkLogin(api().fetch, 'wrong-token', 'jdupont', noWait)).toBe('unknown');
    const odd: FetchLike = async () => new Response('{}', { status: 200 });
    expect(await checkLogin(odd, 'token-123', 'jdupont', noWait)).toBe('unknown');
  });

  it('waits and tries again on a 429, then gives up after three attempts', async () => {
    let calls = 0;
    const flaky: FetchLike = async () =>
      ++calls < 3
        ? new Response('{}', { status: 429 })
        : new Response('{"login":"jdupont"}', { status: 200 });
    expect(await checkLogin(flaky, 'token-123', 'jdupont', noWait)).toBe('exists');
    expect(calls).toBe(3);

    let always = 0;
    const busy: FetchLike = async () => (++always, new Response('{}', { status: 429 }));
    expect(await checkLogin(busy, 'token-123', 'jdupont', noWait)).toBe('unknown');
    expect(always).toBe(3);
  });
});

describe('searching campuses', () => {
  const campuses: Campus[] = CAMPUSES.map((c) => ({
    id: c.id,
    name: c.name,
    country: c.country,
    timeZone: c.time_zone,
  }));

  it('folds case and accents', () => {
    expect(fold('  Montréal ')).toBe('montreal');
    expect(fold('SÃO PAULO')).toBe('sao paulo');
  });

  it('finds a campus by any part of its name, ignoring case and accents', () => {
    expect(searchCampuses(campuses, 'montreal').map((c) => c.name)).toEqual(['Montréal']);
    expect(searchCampuses(campuses, 'ARI').map((c) => c.name)).toEqual(['Paris']);
    expect(searchCampuses(campuses, 'nic').map((c) => c.name)).toEqual(['Nice', 'Nicosia']);
  });

  it('puts the names that start with the query first', () => {
    const list: Campus[] = ['Port Nice', 'Nice', 'Nicosia'].map((name, id) => ({
      id,
      name,
      country: '',
      timeZone: undefined,
    }));
    expect(searchCampuses(list, 'nic').map((c) => c.name)).toEqual([
      'Nice',
      'Nicosia',
      'Port Nice',
    ]);
  });

  it('finds nothing for an empty or unknown query', () => {
    expect(searchCampuses(campuses, '')).toEqual([]);
    expect(searchCampuses(campuses, '   ')).toEqual([]);
    expect(searchCampuses(campuses, 'zzz')).toEqual([]);
  });
});

describe('listCampuses: limits and waiting', () => {
  const full = (page: number) =>
    Array.from({ length: 100 }, (_, i) => ({ id: page * 1000 + i, name: `C${page}-${i}` }));

  it('stops after ten pages even if every page is full', async () => {
    let calls = 0;
    const endless: FetchLike = async () =>
      new Response(JSON.stringify(full(++calls)), { status: 200 });
    const list = await listCampuses(endless, 'token-123', noWait);
    expect(calls).toBe(10);
    expect(list).toHaveLength(1000);
  });

  it('tries a page three times at most when 42 keeps saying 429', async () => {
    let calls = 0;
    const busy: FetchLike = async () => (++calls, new Response('{}', { status: 429 }));
    expect(await listCampuses(busy, 'token-123', noWait)).toBeNull();
    expect(calls).toBe(3);
  });

  it('waits the time 42 asks for, at most ten seconds, and 1.5 s when it says nothing sensible', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    for (const header of ['60', '0', '-3', 'soon', undefined]) {
      let first = true;
      const flaky: FetchLike = async () => {
        if (first) {
          first = false;
          return new Response('{}', {
            status: 429,
            headers: header === undefined ? {} : { 'Retry-After': header },
          });
        }
        return new Response('[]', { status: 200 });
      };
      await listCampuses(flaky, 'token-123', sleep);
    }
    expect(waits).toEqual([10_000, 1500, 1500, 1500, 1500]);
  });
});

describe('searchCampuses: order', () => {
  it('puts the names that start with the query before the others, then sorts by name', () => {
    const list: Campus[] = ['Port Nice', 'Nicosia', 'Nice', 'Aniceto'].map((name, id) => ({
      id,
      name,
      country: '',
      timeZone: undefined,
    }));
    expect(searchCampuses(list, 'nic').map((c) => c.name)).toEqual([
      'Nice',
      'Nicosia',
      'Aniceto',
      'Port Nice',
    ]);
  });
});
