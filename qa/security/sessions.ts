import { encode } from '@auth/core/jwt';
import type { Platform } from '../access/http';
import { SESSION_COOKIE, forgeSessionCookie, persona } from '../personas';
import { Report, redirectOf, send, type Response2 } from './core';

/**
 * A cookie nobody issued, or issued for somebody else, is a visitor and nothing more: never somebody, never an error
 * page. Every case below is tried on the page of the application and on a route that takes the session, and must
 * answer exactly what the visitor with no cookie gets.
 */

const PROBES = ['/fr/dashboard', '/fr/members', '/api/me/export'] as const;

const OWNER = persona('owner');

interface Forged {
  name: string;
  cookie: string;
  /** The same case with a persona that is not an owner, to see that nothing is lifted by the cookie that rides along. */
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkSessions(platform: Platform, report: Report): Promise<void> {
  const owner = OWNER.login as string;
  const valid = await forgeSessionCookie(owner, platform.secret);
  const otherSecret = await forgeSessionCookie(owner, `${platform.secret}-not-the-secret`);
  const unknown = await forgeSessionCookie('nobody-at-all', platform.secret);
  const otherSalt = await encode({
    token: { login: owner },
    secret: platform.secret,
    salt: 'another-cookie-name',
  });
  const expired = await encode({
    token: { login: owner },
    secret: platform.secret,
    salt: SESSION_COOKIE,
    // already over a minute ago (Auth.js reads a token up to 15 seconds late)
    maxAge: -60,
  });

  const flip = (token: string, at: number) =>
    `${token.slice(0, at)}${token[at] === 'A' ? 'B' : 'A'}${token.slice(at + 1)}`;

  const cases: Forged[] = [
    { name: 'garbage', cookie: `${SESSION_COOKIE}=not-a-token` },
    { name: 'an empty value', cookie: `${SESSION_COOKIE}=` },
    { name: 'a very long value (8 kB)', cookie: `${SESSION_COOKIE}=${'x'.repeat(8000)}` },
    {
      name: 'a real token with one character changed (near the start)',
      cookie: `${SESSION_COOKIE}=${flip(valid, 40)}`,
    },
    {
      name: 'a real token with one character changed (in the middle)',
      cookie: `${SESSION_COOKIE}=${flip(valid, Math.floor(valid.length / 2))}`,
    },
    {
      name: 'a real token with its end cut off',
      cookie: `${SESSION_COOKIE}=${valid.slice(0, -12)}`,
    },
    {
      name: 'a token of the right form signed with another secret',
      cookie: `${SESSION_COOKIE}=${otherSecret}`,
    },
    {
      name: 'a token for a login the platform does not know',
      cookie: `${SESSION_COOKIE}=${unknown}`,
    },
    {
      name: 'a token made for another cookie (another salt)',
      cookie: `${SESSION_COOKIE}=${otherSalt}`,
    },
    { name: 'a token that has expired', cookie: `${SESSION_COOKIE}=${expired}` },
    {
      name: 'a token sent under the name of the HTTPS cookie, over http',
      cookie: `__Secure-${SESSION_COOKIE}=${valid}`,
    },
    {
      name: 'a token in a cookie of the sign-in that is not the session',
      cookie: `authjs.callback-url=${valid}`,
    },
    {
      name: 'a garbage cookie first, the real one second (two with the same name)',
      cookie: `${SESSION_COOKIE}=garbage; ${SESSION_COOKIE}=${valid}`,
    },
    {
      name: 'a token with a "Bearer" prefix, the way an API would take it',
      cookie: `${SESSION_COOKIE}=Bearer ${valid}`,
    },
  ];

  const anonymous = Object.fromEntries(
    await Promise.all(PROBES.map(async (path) => [path, await send(platform, path)] as const)),
  ) as Record<(typeof PROBES)[number], Response2>;
  const shape = (response: Response2) =>
    `${response.status} ${redirectOf(response, platform) ?? ''} ${response.headers.get('content-type')?.split(';')[0] ?? ''}`;

  for (const path of PROBES) {
    const baseline = shape(anonymous[path]);
    report.check(
      'sessions',
      `${path}: the visitor with no cookie is refused (the other cases are compared to it)`,
      anonymous[path].status !== 200 || Boolean(redirectOf(anonymous[path], platform)),
      baseline,
    );
    for (const forged of cases) {
      const response = await send(platform, path, { cookie: forged.cookie });
      const same = shape(response) === baseline;
      report.check(
        'sessions',
        `${path}: ${forged.name}: treated as a visitor`,
        same && response.status < 500,
        `${shape(response)} (the visitor gets ${baseline})`,
      );
    }
  }

  // The real cookie, and the real cookie with others that try to change who it is.
  const real = await send(platform, '/fr/members', { cookie: `${SESSION_COOKIE}=${valid}` });
  report.check(
    'sessions',
    'a real owner cookie opens the members (the other cases mean something)',
    real.status === 200 && !redirectOf(real, platform),
    shape(real),
  );

  const memberCookie = await forgeSessionCookie(persona('member').login as string, platform.secret);
  for (const [name, extra] of [
    ['the development cookie that names a role', 'dev-impersonation-role=role:role-admin'],
    ['the development cookie that names the owner', 'dev-impersonation-role=OWNER'],
    ['a cookie that claims an owner’s login', `login=${owner}; user=${owner}; status=OWNER`],
  ] as const) {
    const response = await send(platform, '/fr/members', {
      cookie: `${SESSION_COOKIE}=${memberCookie}; ${extra}`,
    });
    report.check(
      'sessions',
      `a member who also sends ${name} is still a member`,
      redirectOf(response, platform) === '/fr/dashboard',
      shape(response),
    );
  }

  // Not a way to learn who exists: an unknown login and a removed member answer like anybody else.
  const removed = await send(platform, '/fr/dashboard', { as: 'deleted' });
  report.check(
    'sessions',
    'a removed member is signed out like a visitor',
    shape(removed) === shape(anonymous['/fr/dashboard']),
    shape(removed),
  );

  // The session route: what it says to a visitor, and that it does not echo the cookie.
  const session = await send(platform, '/api/auth/session', {
    cookie: `${SESSION_COOKIE}=${otherSecret}`,
  });
  report.check(
    'sessions',
    'the session route says nothing about a forged cookie',
    /^(null)?\s*$/.test(session.body.trim()) || session.body.trim() === 'null',
    session.body.slice(0, 80),
  );
}
