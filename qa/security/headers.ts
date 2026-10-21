import type { Platform } from '../access/http';
import type { PersonaKey } from '../personas';
import { Report, send, type Response2 } from './core';

/**
 * The headers of every kind of answer, checked against what a hardened interface sends, written down on its own (not
 * read from `src/lib/security-headers.ts`: when the two disagree, one of them is wrong).
 */

/** `{ 'default-src': ["'self'"], … }` for a Content-Security-Policy. */
export function parseCsp(value: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = sources;
  }
  return directives;
}

/** What is wrong with a policy, one sentence each (empty: nothing). */
export function cspProblems(value: string): string[] {
  const csp = parseCsp(value);
  const problems: string[] = [];
  const only = (name: string, wanted: readonly string[]) => {
    const found = csp[name];
    if (!found) problems.push(`${name} is missing`);
    else if (found.length !== wanted.length || !wanted.every((source) => found.includes(source))) {
      problems.push(`${name} is ${found.join(' ')}, expected ${wanted.join(' ')}`);
    }
  };

  only('default-src', ["'self'"]);
  only('object-src', ["'none'"]);
  only('base-uri', ["'self'"]);
  only('frame-ancestors', ["'none'"]);
  only('connect-src', ["'self'"]);

  for (const [name, sources] of Object.entries(csp)) {
    for (const source of sources) {
      if (source === '*') problems.push(`${name} allows every origin`);
      if (source === "'unsafe-eval'") problems.push(`${name} allows eval`);
      if (/^https?:$/.test(source)) problems.push(`${name} allows every ${source} address`);
      if (source === 'data:' && name !== 'img-src') problems.push(`${name} allows data: addresses`);
    }
  }
  // Images: the platform itself, what it embeds, and 42's pictures; nothing else.
  for (const source of csp['img-src'] ?? []) {
    if (!["'self'", 'data:', 'blob:', 'https://cdn.intra.42.fr'].includes(source))
      problems.push(`img-src allows ${source}`);
  }
  // Forms: the platform, and the sign-in with 42.
  for (const source of csp['form-action'] ?? []) {
    if (!["'self'", 'https://api.intra.42.fr'].includes(source))
      problems.push(`form-action allows ${source}`);
  }
  if (!csp['form-action']) problems.push('form-action is missing');
  return problems;
}

/** The policy of a route that answers with its own (the logo: nothing may run, nothing may load). */
export const OWN_POLICY = "default-src 'none'; sandbox";

/**
 * What a response must have, whatever it is. A route that writes a policy of its own (`ownPolicy`) must send exactly
 * that one, refusals included: it replaces the policy of the pages instead of adding to it.
 */
export function missingEverywhere(
  response: Response2,
  { ownPolicy = false }: { ownPolicy?: boolean } = {},
): string[] {
  const missing: string[] = [];
  const header = (name: string) => response.headers.get(name);
  const csp = header('content-security-policy');
  if (!csp) missing.push('Content-Security-Policy');
  else if (ownPolicy) {
    if (csp !== OWN_POLICY)
      missing.push(`Content-Security-Policy is ${csp}, expected ${OWN_POLICY}`);
  } else missing.push(...cspProblems(csp));
  if (header('x-content-type-options')?.toLowerCase() !== 'nosniff')
    missing.push('X-Content-Type-Options: nosniff');
  if (header('x-frame-options')?.toUpperCase() !== 'DENY') missing.push('X-Frame-Options: DENY');
  if (!header('referrer-policy')) missing.push('Referrer-Policy');
  if (!header('permissions-policy')) missing.push('Permissions-Policy');
  if (header('x-powered-by')) missing.push(`no X-Powered-By (it says ${header('x-powered-by')})`);
  if (/\d/.test(header('server') ?? ''))
    missing.push(`no version in Server (it says ${header('server')})`);
  const origin = header('access-control-allow-origin');
  if (origin) missing.push(`no CORS (it allows ${origin})`);
  return missing;
}

/** Strings that must never reach a visitor: where the code lives, and what an error knows. */
const LEAKS = [
  /\/app\/(src|\.next|node_modules)/,
  /node_modules\//,
  /\bat (Object|async|Module|Function)\./,
  /PrismaClient/,
  /\bECONNREFUSED\b/,
  /postgres(ql)?:\/\//i,
  /stack trace/i,
];

export async function checkHeaders(platform: Platform, report: Report): Promise<void> {
  const probes: { label: string; path: string; as?: PersonaKey; ownPolicy?: boolean }[] = [
    { label: 'the login page', path: '/fr' },
    { label: 'a page of the application', path: '/fr/dashboard', as: 'owner' },
    { label: 'the events', path: '/fr/events', as: 'member' },
    { label: 'the settings', path: '/fr/settings', as: 'owner' },
    { label: 'a page that does not exist', path: '/fr/does/not/exist' },
    { label: 'the privacy policy', path: '/en/privacy' },
    { label: 'liveness', path: '/api/health' },
    { label: 'the session route', path: '/api/auth/session' },
    { label: 'a logo that does not exist', path: '/api/logo?v=0000000000000000', ownPolicy: true },
    { label: 'a feed that does not exist', path: `/api/calendar/${'A'.repeat(43)}` },
    { label: 'the export of one’s data', path: '/api/me/export', as: 'member' },
  ];

  for (const probe of probes) {
    const response = await send(platform, probe.path, probe.as ? { as: probe.as } : {});
    const missing = missingEverywhere(response, { ownPolicy: probe.ownPolicy });
    report.check(
      'headers',
      `${probe.label}: the headers every answer carries`,
      missing.length === 0,
      missing.join('; '),
    );
  }

  // Somebody's own pages are never kept by a cache that others use.
  for (const [label, path, as] of [
    ['the dashboard', '/fr/dashboard', 'member'],
    ['the members', '/fr/members', 'owner'],
    ['the profile', '/fr/profile', 'member'],
    ['the export of one’s data', '/api/me/export', 'member'],
  ] as const) {
    const response = await send(platform, path, { as });
    const control = (response.headers.get('cache-control') ?? '').toLowerCase();
    report.check(
      'headers',
      `${label}: not kept by a shared cache`,
      /no-store|private/.test(control) && !/\bpublic\b/.test(control),
      `Cache-Control: ${control || '(none)'}`,
    );
  }

  // An address that is not found, or an error, says nothing of the code behind it.
  for (const path of [
    '/fr/does/not/exist',
    '/fr/events/%00',
    '/api/calendar/%ff',
    '/fr/events/..%2f..%2fetc%2fpasswd',
  ]) {
    const response = await send(platform, path, { as: 'owner' });
    const leaked = LEAKS.find((pattern) => pattern.test(response.body));
    report.check(
      'headers',
      `${path}: no trace of the code in the answer`,
      !leaked,
      leaked ? `matches ${leaked}` : `status ${response.status}`,
    );
    report.check(
      'headers',
      `${path}: not a server error`,
      response.status < 500,
      `status ${response.status}`,
    );
  }

  // HSTS: only to somebody who came over HTTPS (behind the proxy), never over plain http.
  const plain = await send(platform, '/fr');
  report.check(
    'headers',
    'over plain http, no HSTS (a BDE without HTTPS must not be told to insist)',
    !plain.headers.get('strict-transport-security'),
  );
  const secure = await send(platform, '/fr', { headers: { 'x-forwarded-proto': 'https' } });
  const hsts = secure.headers.get('strict-transport-security') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  report.check(
    'headers',
    'behind an HTTPS proxy, HSTS for at least 180 days',
    maxAge >= 15_552_000,
    hsts || '(none)',
  );
  report.check(
    'headers',
    'HSTS does not cover the subdomains (they are not the platform’s)',
    !/includeSubDomains/i.test(hsts),
  );

  // No CORS: a page of another site cannot read the answers, with or without the cookie.
  const preflight = await send(platform, '/api/me/export', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
  });
  report.check(
    'headers',
    'a preflight from another site is not granted',
    !preflight.headers.get('access-control-allow-origin') &&
      !preflight.headers.get('access-control-allow-credentials'),
    `status ${preflight.status}`,
  );

  // The cookies of the sign-in are HttpOnly, SameSite, and never readable by a script.
  const csrf = await fetch(`${platform.base}/api/auth/csrf`, { redirect: 'manual' });
  const cookies = csrf.headers.getSetCookie();
  report.check(
    'headers',
    'the cookies of the sign-in are set at all (the check below means something)',
    cookies.length > 0,
    `${cookies.length} cookies`,
  );
  for (const cookie of cookies) {
    const name = cookie.split('=')[0];
    report.check(
      'headers',
      `cookie ${name}: HttpOnly`,
      /;\s*HttpOnly/i.test(cookie),
      cookie.replace(/=[^;]+/, '=…'),
    );
    report.check(
      'headers',
      `cookie ${name}: SameSite`,
      /;\s*SameSite=(Lax|Strict)/i.test(cookie),
      cookie.replace(/=[^;]+/, '=…'),
    );
    report.check(
      'headers',
      `cookie ${name}: for the whole site, not a path that is easy to shadow`,
      /;\s*Path=\//i.test(cookie),
    );
  }
}
