import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkFortyTwoCredentials,
  resetFortyTwoCredentialsCheck,
  warnIfFortyTwoRejectsTheApplication,
} from './oauth-check';

const reply = (status: number, body: unknown = {}) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }));

describe('checkFortyTwoCredentials', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.FORTYTWO_CLIENT_ID = 'the-uid';
    process.env.FORTYTWO_CLIENT_SECRET = 'the-secret';
    resetFortyTwoCredentialsCheck();
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('asks 42 for a token of the application itself, with the secret in the body only', async () => {
    const fetchMock = reply(200, { access_token: 'x' });
    expect(await checkFortyTwoCredentials(fetchMock)).toBe('valid');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.intra.42.fr/oauth/token');
    expect(init?.method).toBe('POST');
    expect(String(url)).not.toContain('the-secret');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('the-uid');
    expect(body.get('client_secret')).toBe('the-secret');
  });

  it('says "rejected" only when 42 itself says invalid_client', async () => {
    expect(await checkFortyTwoCredentials(reply(401, { error: 'invalid_client' }))).toBe(
      'rejected',
    );
    resetFortyTwoCredentialsCheck();
    expect(await checkFortyTwoCredentials(reply(400, { error: 'invalid_client' }))).toBe(
      'rejected',
    );
  });

  it.each([
    ['a rate limit', () => reply(429, { error: 'too_many' })],
    ['an outage', () => reply(503)],
    ['another refusal', () => reply(401, { error: 'invalid_request' })],
    [
      'an answer that is not JSON',
      () => vi.fn<typeof fetch>(async () => new Response('<html>', { status: 401 })),
    ],
    [
      'no network',
      () => vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('fetch failed'))),
    ],
  ])('knows nothing about the application after %s', async (_name, makeFetch) => {
    expect(await checkFortyTwoCredentials(makeFetch())).toBe('unknown');
  });

  it('does not ask without an identifier and a secret', async () => {
    process.env.FORTYTWO_CLIENT_SECRET = '';
    const fetchMock = reply(200);
    expect(await checkFortyTwoCredentials(fetchMock)).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers from its cache, a refusal being rechecked sooner than a success', async () => {
    let time = 1_000_000;
    const fetchMock = reply(200);
    await checkFortyTwoCredentials(fetchMock, () => time);
    time += 9 * 60_000;
    await checkFortyTwoCredentials(fetchMock, () => time);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    time += 2 * 60_000;
    await checkFortyTwoCredentials(fetchMock, () => time);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resetFortyTwoCredentialsCheck();
    const refused = reply(401, { error: 'invalid_client' });
    await checkFortyTwoCredentials(refused, () => time);
    time += 3 * 60_000;
    await checkFortyTwoCredentials(refused, () => time);
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it('makes one request for visitors who arrive together', async () => {
    const fetchMock = reply(200);
    await Promise.all([1, 2, 3].map(() => checkFortyTwoCredentials(fetchMock)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('warnIfFortyTwoRejectsTheApplication', () => {
  beforeEach(() => {
    process.env.FORTYTWO_CLIENT_ID = 'the-uid';
    process.env.FORTYTWO_CLIENT_SECRET = 'the-secret';
    resetFortyTwoCredentialsCheck();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('warns in French, naming the variables and never the secret, when 42 refuses it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', reply(401, { error: 'invalid_client' }));
    warnIfFortyTwoRejectsTheApplication();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    const text = String(warn.mock.calls[0]?.[0]);
    expect(text).toContain('FORTYTWO_CLIENT_SECRET');
    expect(text).toContain('docker compose up -d');
    expect(text).not.toContain('the-secret');
  });

  it('says nothing when all is well', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = reply(200);
    vi.stubGlobal('fetch', fetchMock);
    warnIfFortyTwoRejectsTheApplication();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(warn).not.toHaveBeenCalled();
  });
});
