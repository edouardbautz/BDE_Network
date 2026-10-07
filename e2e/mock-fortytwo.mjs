// A stand-in for the 42 API, for the end-to-end test of the installer (e2e/install.mjs): the real one needs a
// real application, and a test must not depend on the network. The platform is pointed at it with
// FORTYTWO_API_URL (src/lib/fortytwo-api.ts).
//
//   node e2e/mock-fortytwo.mjs [port]
//
// It knows one application (UID / SECRET below), three campuses and two logins.
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

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function startMock(port = 4242) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const form = new URLSearchParams(body);
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
