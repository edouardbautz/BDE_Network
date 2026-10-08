// A stand-in for the 42 API, for the end-to-end test of the installer (e2e/install.mjs): the real one needs a
// real application, and a test must not depend on the network. The platform is pointed at it with
// FORTYTWO_API_URL (src/lib/fortytwo-api.ts).
//
//   node e2e/mock-fortytwo.mjs [port]
//
// It knows one application (UID / SECRET below), three campuses and two logins. It also plays the sign-in
// itself (e2e/signin.mjs): /oauth/authorize sends the browser back with a code, /oauth/token exchanges it, but
// like the real 42 only for the redirect_uri the authorization was asked with, and /__sign-ins tells which
// redirect_uri each leg received.
import { createServer } from 'node:http';

export const CLIENT_ID = 'u-s4t2ud-e2e-test-uid';
export const CLIENT_SECRET = 's-s4t2ud-e2e-test-secret';
const TOKEN = 'e2e-token';
const LOGINS = new Set(['alice', 'bob']);
const CAMPUSES = [
  { id: 1, name: 'Paris', country: 'France', time_zone: 'Europe/Paris' },
  { id: 2, name: 'Nice', country: 'France', time_zone: 'Europe/Paris' },
  { id: 3, name: 'Montréal', country: 'Canada', time_zone: 'America/Montreal' },
];

/** The sign-ins played so far: the redirect_uri of the authorization and of the exchange of its code. */
const signIns = [];

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function startMock(port = 4242) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/__sign-ins') return send(response, 200, signIns);

    // The way out of a sign-in: the person is sent back to the platform with a code.
    if (url.pathname === '/oauth/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri');
      if (url.searchParams.get('client_id') !== CLIENT_ID || !redirectUri) {
        return send(response, 400, { error: 'invalid_request' });
      }
      const code = `code-${signIns.length + 1}`;
      signIns.push({ code, authorizeRedirectUri: redirectUri });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      const state = url.searchParams.get('state');
      if (state) back.searchParams.set('state', state);
      response.writeHead(302, { Location: back.href });
      return response.end();
    }

    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'authorization_code') {
          // The way back: like the real 42, only for the redirect_uri the authorization was asked with.
          const signIn = signIns.find((entry) => entry.code === form.get('code'));
          if (signIn) signIn.tokenRedirectUri = form.get('redirect_uri');
          // Auth.js authenticates the application with an HTTP Basic header (the body works too).
          const basic = /^Basic (.+)$/.exec(request.headers.authorization ?? '')?.[1];
          const [basicId, basicSecret] = basic
            ? Buffer.from(basic, 'base64').toString().split(':').map(decodeURIComponent)
            : [];
          const secret = basicSecret ?? form.get('client_secret');
          const id = basicId ?? form.get('client_id');
          const known = signIn && id === CLIENT_ID && secret === CLIENT_SECRET;
          if (known && signIn.authorizeRedirectUri === form.get('redirect_uri')) {
            return send(response, 200, { access_token: TOKEN, token_type: 'bearer' });
          }
          return send(response, 400, {
            error: 'invalid_grant',
            error_description:
              'The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.',
          });
        }
        const valid =
          form.get('grant_type') === 'client_credentials' &&
          form.get('client_id') === CLIENT_ID &&
          form.get('client_secret') === CLIENT_SECRET;
        if (valid) return send(response, 200, { access_token: TOKEN, token_type: 'bearer' });
        return send(response, 401, { error: 'invalid_client' });
      });
      return;
    }

    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(response, 401, { error: 'invalid_token' });
    }
    if (url.pathname === '/v2/me') {
      return send(response, 200, {
        id: 1001,
        login: 'alice',
        email: 'alice@example.org',
        first_name: 'Alice',
        last_name: 'Martin',
        usual_full_name: null,
        image: null,
        campus: [CAMPUSES[1]],
        campus_users: [{ campus_id: CAMPUSES[1].id, is_primary: true }],
      });
    }
    if (url.pathname === '/v2/campus') {
      const page = Number(url.searchParams.get('page[number]') ?? '1');
      return send(response, 200, page === 1 ? CAMPUSES : []);
    }
    const user = /^\/v2\/users\/([^/]+)$/.exec(url.pathname)?.[1];
    if (user) {
      return LOGINS.has(decodeURIComponent(user))
        ? send(response, 200, { login: decodeURIComponent(user) })
        : send(response, 404, { error: 'not found' });
    }
    return send(response, 404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}

if (process.argv[1]?.endsWith('mock-fortytwo.mjs')) {
  const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4242);
  startMock(port).then(() => console.log(`mock 42 API on :${port}`));
}
