// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setRuntimeSettings } from '@/lib/settings/runtime';

/**
 * The bug this guards: after a fresh installation, "Se connecter avec 42" ended on
 * `http://0.0.0.0:3000/fr/auth-error?error=Configuration` and the logs said `invalid_grant` ("does not
 * match the redirection URI used in the authorization request").
 *
 * In the production image the server listens on 0.0.0.0, and Next.js then builds `request.url` from that
 * address (reproduced against the real image: the callback answered `Location: http://0.0.0.0:3000/auth-error`).
 * Auth.js made its redirect_uri and its redirects from the URL of the request, so 42 was given
 * `http://0.0.0.0:3000/api/auth/callback/42-school` when the code was exchanged, never the address the
 * authorization had been asked with.
 *
 * Everything between the HTTP server and 42 is real here: the route handlers, the NextAuth configuration,
 * the 42 provider. Only the database callbacks are replaced (they are not what is tested) and 42 is a small
 * server that, like the real one, refuses a code whose redirect_uri is not the one the authorization used.
 */

const { SECRET } = vi.hoisted(() => {
  const SECRET = 'public-address-test-secret-0123456789';
  process.env.AUTH_SECRET = SECRET;
  return { SECRET };
});
void SECRET;

vi.mock('@/lib/auth/callbacks', () => ({
  AUTH_ERROR_PATH: '/auth-error',
  signInCallback: vi.fn(async () => true),
  jwtCallback: vi.fn(async ({ token }: { token: unknown }) => token),
  sessionCallback: vi.fn(async ({ session }: { session: unknown }) => session),
}));

import { GET, POST } from '@/app/api/auth/[...nextauth]/route';

const CALLBACK_PATH = '/api/auth/callback/42-school';

interface FortyTwoRecord {
  authorizeRedirectUri?: string;
  tokenRedirectUri?: string;
  tokenAnswer?: number;
}

let fortyTwo: Server;
let platform: Server;
let record: FortyTwoRecord = {};
let fortyTwoUrl: string;
/** The port the platform listens on (on 0.0.0.0, like the image). */
let port: number;

const body = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(data));
  });

/** A stand-in for the 42 API that checks the redirect_uri of the token request like the real one does. */
function handleFortyTwo(request: IncomingMessage, response: ServerResponse): void {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      const form = new URLSearchParams(await body(request));
      record.tokenRedirectUri = form.get('redirect_uri') ?? undefined;
      const matches = record.tokenRedirectUri === record.authorizeRedirectUri;
      record.tokenAnswer = matches ? 200 : 400;
      response.writeHead(record.tokenAnswer, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify(
          matches
            ? { access_token: 'token', token_type: 'bearer' }
            : {
                error: 'invalid_grant',
                error_description:
                  'The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.',
              },
        ),
      );
      return;
    }
    if (url.pathname === '/v2/me') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 1,
          login: 'alice',
          email: 'alice@example.org',
          first_name: 'Alice',
          last_name: 'Martin',
          usual_full_name: null,
          image: null,
          campus: [{ id: 1, name: 'Paris' }],
          campus_users: [{ campus_id: 1, is_primary: true }],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  })();
}

/**
 * The platform as the image runs it: listening on 0.0.0.0, and handing the route handlers a request whose URL
 * carries that listening address, whatever the visitor asked for (what Next.js does inside the container).
 */
function handlePlatform(request: IncomingMessage, response: ServerResponse): void {
  void (async () => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const method = request.method ?? 'GET';
    const payload = method === 'GET' ? undefined : await body(request);
    const nextRequest = new NextRequest(`http://0.0.0.0:${port}${request.url}`, {
      method,
      headers,
      body: payload,
    });
    const handler = method === 'GET' ? GET : POST;
    const result = await handler(nextRequest);
    const cookies = result.headers.getSetCookie();
    const plain: Record<string, string> = {};
    result.headers.forEach((value, name) => {
      if (name !== 'set-cookie') plain[name] = value;
    });
    response.writeHead(result.status, { ...plain, 'set-cookie': cookies });
    response.end(await result.text());
  })();
}

const listen = (server: Server, host: string): Promise<number> =>
  new Promise((resolve) =>
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port)),
  );

/** A browser in a few lines: sends back the cookies it was given, never follows a redirect. */
function browser(origin: string) {
  const jar = new Map<string, string>();
  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(cookie && { cookie }) },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  };
  return {
    get: (path: string) => send(path),
    async post(path: string, form: Record<string, string>) {
      return send(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
    },
  };
}

/** The sign-in as a visitor does it: CSRF token, then the sign-in form posted to the provider. */
async function startSignIn(visitor: ReturnType<typeof browser>): Promise<URL> {
  const { csrfToken } = (await (await visitor.get('/api/auth/csrf')).json()) as {
    csrfToken: string;
  };
  const response = await visitor.post('/api/auth/signin/42-school', { csrfToken });
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location') ?? '');
}

function register(appUrl: string | undefined): void {
  setRuntimeSettings({
    // The configuration is not read by the sign-in; the provider reads the 42 application from the settings.
    config: {} as never,
    values: {
      ...(appUrl && { APP_URL: appUrl }),
      FORTYTWO_CLIENT_ID: 'u-s4t2ud-test-uid',
      FORTYTWO_CLIENT_SECRET: 's-s4t2ud-test-secret',
    },
    source: 'database',
  });
}

beforeAll(async () => {
  fortyTwo = createServer(handleFortyTwo);
  fortyTwoUrl = `http://127.0.0.1:${await listen(fortyTwo, '127.0.0.1')}`;
  process.env.FORTYTWO_API_URL = fortyTwoUrl;
  platform = createServer(handlePlatform);
  port = await listen(platform, '0.0.0.0');
});

afterAll(async () => {
  delete process.env.FORTYTWO_API_URL;
  delete process.env.AUTH_URL;
  await Promise.all([fortyTwo, platform].map((s) => new Promise((done) => s.close(done))));
});

afterEach(() => {
  setRuntimeSettings(undefined);
  delete process.env.AUTH_URL;
  record = {};
});

describe('the sign-in with a server that listens on 0.0.0.0', () => {
  it.each([
    ['an https address behind a proxy', () => 'https://bde.exemple.fr'],
    ['localhost with its port', () => `http://localhost:${port}`],
    ['an http address with the default port left out', () => 'http://bde.exemple.fr'],
    [
      'localhost, written 127.0.0.1 (Next.js reads it as localhost)',
      () => `http://127.0.0.1:${port}`,
    ],
  ])(
    'sends 42 the registered address + the callback path, both ways (%s)',
    async (_label, address) => {
      const registered = address();
      register(registered);
      // One spelling on the way out and on the way back: Next.js reads 127.0.0.1 as localhost everywhere.
      const expected = registered.replace('127.0.0.1', 'localhost');
      // The visitor reaches the platform by a different name than the registered one (127.0.0.1 here): the
      // registered address still wins, it is the only one 42 knows.
      const visitor = browser(`http://127.0.0.1:${port}`);

      // The way out: the authorization request.
      const authorize = await startSignIn(visitor);
      expect(authorize.origin).toBe(fortyTwoUrl);
      expect(authorize.pathname).toBe('/oauth/authorize');
      record.authorizeRedirectUri = authorize.searchParams.get('redirect_uri') ?? undefined;
      expect(record.authorizeRedirectUri).toBe(`${expected}${CALLBACK_PATH}`);

      // The way back: 42 sends the visitor to the callback with a code; the code is exchanged for a token.
      const callback = await visitor.get(`${CALLBACK_PATH}?code=the-code`);
      expect(record.tokenRedirectUri).toBe(`${expected}${CALLBACK_PATH}`);
      expect(record.tokenAnswer).toBe(200);

      // ...and the visitor ends up on the platform's address, never on the one the server listens on.
      expect(callback.status).toBe(302);
      const next = new URL(callback.headers.get('location') ?? '');
      expect(next.origin).toBe(new URL(expected).origin);
      expect(next.href).not.toContain('0.0.0.0');
    },
  );

  it('sends the visitor to the error page of the platform address, not of the listening one', async () => {
    register('https://bde.exemple.fr');
    const visitor = browser(`http://127.0.0.1:${port}`);
    await startSignIn(visitor);

    // A code 42 refuses (here: no authorization was recorded, so the redirect_uri cannot match).
    const response = await visitor.get(`${CALLBACK_PATH}?code=the-code`);
    expect(record.tokenAnswer).toBe(400);
    const next = new URL(response.headers.get('location') ?? '');
    expect(next.origin).toBe('https://bde.exemple.fr');
    expect(next.pathname).toBe('/auth-error');
    expect(next.href).not.toContain('0.0.0.0');
  });

  it('falls back on the address the visitor used when none is registered, never on 0.0.0.0', async () => {
    register(undefined);
    const visitor = browser(`http://127.0.0.1:${port}`);

    const authorize = await startSignIn(visitor);
    record.authorizeRedirectUri = authorize.searchParams.get('redirect_uri') ?? undefined;
    expect(record.authorizeRedirectUri).toBe(`http://localhost:${port}${CALLBACK_PATH}`);

    const callback = await visitor.get(`${CALLBACK_PATH}?code=the-code`);
    expect(record.tokenRedirectUri).toBe(record.authorizeRedirectUri);
    expect(record.tokenAnswer).toBe(200);
    expect(callback.headers.get('location')).not.toContain('0.0.0.0');
  });

  it('ignores an unusable registered address (0.0.0.0, saved by an older installation)', async () => {
    register(`http://0.0.0.0:${port}`);
    const visitor = browser(`http://127.0.0.1:${port}`);

    const authorize = await startSignIn(visitor);
    record.authorizeRedirectUri = authorize.searchParams.get('redirect_uri') ?? undefined;
    expect(record.authorizeRedirectUri).toBe(`http://localhost:${port}${CALLBACK_PATH}`);

    await visitor.get(`${CALLBACK_PATH}?code=the-code`);
    expect(record.tokenAnswer).toBe(200);
  });
});
