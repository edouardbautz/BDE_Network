import { randomBytes } from 'node:crypto';
import type { Platform } from '../access/http';
import { Report, send } from './core';

/**
 * What the platform does under a hostile load, and what it does NOT do: it has no rate limit of its own outside the
 * installer (the reverse proxy of the BDE is where one belongs, `docs/en/deployment.md`). Two things are checked: that a
 * flood of requests that are all wrong costs nothing but time (no error, no crash, the platform answers a member
 * afterwards), and, as a fact written down rather than a failure, how many requests of each kind it accepted.
 */

const BURST = 300;
const CONCURRENCY = 40;

/** `total` requests, `CONCURRENCY` at a time; every answer. */
async function flood(
  total: number,
  request: (index: number) => Promise<{ status: number; ms: number }>,
) {
  const answers: { status: number; ms: number }[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= total) return;
      answers.push(await request(index));
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { answers, seconds: (performance.now() - started) / 1000 };
}

const percentile = (values: number[], share: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * share))
  ] ?? 0;

export async function checkLimits(platform: Platform, report: Report): Promise<void> {
  const alive = async (name: string) => {
    const health = await send(platform, '/api/health');
    const page = await send(platform, '/fr/dashboard', { as: 'member' });
    report.check(
      'limits',
      `${name}: the platform still answers a member`,
      health.status === 200 && page.status === 200,
      `health ${health.status}, dashboard ${page.status}`,
    );
  };

  const floods: [
    string,
    (index: number) => Promise<{ status: number; ms: number }>,
    (status: number) => boolean,
  ][] = [
    [
      'wrong calendar links',
      async () => send(platform, `/api/calendar/${randomBytes(32).toString('base64url')}`),
      (status) => status === 404,
    ],
    ['the login page', async () => send(platform, '/fr'), (status) => status === 200],
    [
      'pages asked with a forged cookie',
      async () =>
        send(platform, '/fr/dashboard', {
          cookie: `authjs.session-token=${randomBytes(200).toString('base64url')}`,
        }),
      (status) => status === 307 || status === 200,
    ],
    [
      'the session route',
      async () => send(platform, '/api/auth/session'),
      (status) => status === 200,
    ],
    [
      'POSTs to the sign-in without the token that protects it',
      async () =>
        send(platform, '/api/auth/signin/42-school', {
          method: 'POST',
          body: 'callbackUrl=/',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        }),
      (status) => status < 500,
    ],
    [
      'addresses that do not exist',
      async (index) => send(platform, `/fr/${randomBytes(8).toString('hex')}/${index}`),
      (status) => status === 404 || status === 200,
    ],
  ];

  for (const [name, request, expected] of floods) {
    const { answers, seconds } = await flood(BURST, request);
    const failed = answers.filter((answer) => !expected(answer.status));
    const refused = answers.filter((answer) => answer.status === 429).length;
    report.check(
      'limits',
      `${BURST} requests for ${name}: every answer is the usual one, none is a server error`,
      failed.length === 0 && answers.length === BURST,
      `${answers.length} answered in ${seconds.toFixed(1)} s, p95 ${Math.round(
        percentile(
          answers.map((a) => a.ms),
          0.95,
        ),
      )} ms, ${failed.length} unusual (${[...new Set(failed.map((a) => a.status))].join(',')}), ${refused} refused with 429`,
    );
    await alive(name);
  }

  // Bodies: a refusal that costs nothing, never a crash.
  for (const [name, size] of [
    ['1 MB', 1024 * 1024],
    ['20 MB', 20 * 1024 * 1024],
  ] as const) {
    const body = Buffer.alloc(size, 0x41);
    for (const [target, method] of [
      ['/api/auth/signin/42-school', 'POST'],
      ['/fr/dashboard', 'POST'],
      ['/api/me/export', 'POST'],
      ['/api/health', 'POST'],
    ] as const) {
      const response = await send(platform, target, {
        method,
        body: new Uint8Array(body),
        headers: { 'content-type': 'application/octet-stream' },
      }).catch(() => ({ status: 0, ms: 0 }));
      report.check(
        'limits',
        `a ${name} body sent to ${target} is refused without an error`,
        response.status > 0 && response.status < 500,
        `status ${response.status}`,
      );
    }
    await alive(`a ${name} body`);
  }

  // The header of a request: a cookie or an address that is far too long is refused by the server itself.
  for (const [name, path, headers] of [
    ['a 100 kB cookie', '/fr', { cookie: `a=${'x'.repeat(100_000)}` }],
    ['an address of 100 kB', `/fr/${'a'.repeat(100_000)}`, {}],
    [
      '500 cookies',
      '/fr',
      { cookie: Array.from({ length: 500 }, (_, index) => `c${index}=${index}`).join('; ') },
    ],
  ] as const) {
    const response = await send(platform, path, { headers }).catch(() => ({ status: 0, ms: 0 }));
    report.check(
      'limits',
      `${name}: refused or ignored, never a server error`,
      response.status > 0 && response.status < 500,
      `status ${response.status}`,
    );
  }
  await alive('the oversized headers');

  // What is NOT done, written down: the sign-in page can be asked as often as one likes.
  const started = performance.now();
  const statuses = await Promise.all(
    Array.from({ length: 200 }, () =>
      send(platform, '/api/auth/csrf').then((response) => response.status),
    ),
  );
  report.check(
    'limits',
    'noted: no rate limit on the sign-in routes (the proxy of the BDE is the place for one)',
    statuses.every((status) => status === 200 || status === 429),
    `${statuses.filter((status) => status === 200).length} of 200 answered in ${Math.round(performance.now() - started)} ms, ${statuses.filter((status) => status === 429).length} refused`,
  );
}
