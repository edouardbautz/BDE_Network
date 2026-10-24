import { randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { changedTables, snapshot, withDatabase, type Platform } from '../access/http';
import { persona } from '../personas';
import { Report, redirectOf, send, type Response2 } from './core';

/**
 * What is typed ends up on other people's screens. A member writes an event, a role, a name; the owner opens the page.
 * Three ways to get something in are played, each with the same corpus of hostile text:
 *
 *  - **stored**: the text is in the database (as any action would have put it) and every page that shows it is opened
 *    as the owner, who sees everything;
 *  - **reflected**: the text is in the address (`?removed=`, `?notice=`, `?campus=`…), which some pages show;
 *  - **SQL**: the same addresses with text meant for the database; nothing may change, nothing may fail.
 *
 * What counts as a failure is what a browser would act on: the text appearing in the page with its `<` as it was typed
 * (a tag the browser would build), an element that runs or loads something it was not given, a script of the page that
 * the text ended early.
 */

/** The platform answers on its public address (localhost); the suites reach it by its other name. */
const PLATFORM_HOSTS = new Set(['localhost', '127.0.0.1']);

const tag = `sec${randomBytes(3).toString('hex')}`;

/** Text that a page must show as text. Each has the part a browser would act on. */
export const PAYLOADS: readonly string[] = [
  '<script>alert(1)</script>',
  '</script><script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '"><img src=x onerror=alert(1)>',
  "' onmouseover='alert(1)' x='",
  '" autofocus onfocus="alert(1)',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<style>@import "https://evil.example/x.css"</style>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  '<form action="https://evil.example"><input name=password></form>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<!--',
  ']]><script>alert(1)</script>',
  '<object data="https://evil.example/x"></object><embed src="https://evil.example/x">',
  '<details open ontoggle=alert(1)>',
  '{{constructor.constructor("alert(1)")()}}',
  '${alert(1)}',
  '‮txet desrever‬ ​‍﻿',
  '😀'.repeat(50),
];

/** Text meant for the database. */
export const SQL_PAYLOADS: readonly string[] = [
  "' OR '1'='1",
  '\'; DROP TABLE "User"; --',
  '1; UPDATE "User" SET status=\'OWNER\'; --',
  '\' UNION SELECT login, "calendarToken" FROM "User" --',
  '$1',
  '%',
  '_',
  "\\'",
  '1 OR 1=1',
  "'||(SELECT pg_sleep(5))||'",
];

/** The host an address leads to ('' for a path of the page itself: what a link to the platform is). */
function hostOf(address: string): string {
  try {
    const url = new URL(address, 'http://this-page.invalid');
    return url.hostname === 'this-page.invalid' ? '' : url.hostname;
  } catch {
    return '';
  }
}

const ADDRESS_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'data',
  'srcdoc',
  'poster',
  'xlink:href',
  'background',
  'ping',
  'cite',
  'srcset',
]);

/** What a page that shows hostile text must not contain, found by building the page like a browser. */
export function violations(html: string): string[] {
  const found: string[] = [];
  const dom = new JSDOM(html);
  const document = dom.window.document;

  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.getAttributeNames()) {
      if (/^on/i.test(attribute)) found.push(`<${element.localName} ${attribute}>`);
      // An attribute that is an address: where the browser goes or what it loads. (A label or a title only says the
      // text, as text.)
      if (!ADDRESS_ATTRIBUTES.has(attribute.toLowerCase())) continue;
      const value = element.getAttribute(attribute) ?? '';
      if (/^\s*javascript:/i.test(value))
        found.push(`<${element.localName} ${attribute}="javascript:…">`);
      if (hostOf(value).includes('evil.example'))
        found.push(`<${element.localName} ${attribute}> points to evil.example`);
    }
  }
  for (const name of ['iframe', 'base', 'embed', 'object', 'form']) {
    for (const element of document.querySelectorAll(name)) {
      // The platform's own forms (sign-in, sign-out, the actions) have an action on its own address or none.
      if (name === 'form' && !hostOf(element.getAttribute('action') ?? '').includes('evil'))
        continue;
      found.push(`<${name}> that the text built`);
    }
  }
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (/evil/.test(meta.getAttribute('content') ?? ''))
      found.push('<meta http-equiv> that sends away');
  }
  for (const style of document.querySelectorAll('style')) {
    if (/evil\.example|@import/i.test(style.textContent ?? ''))
      found.push('<style> that loads from elsewhere');
  }
  return found;
}

/** The payloads with a tag in them that are in the body as they were typed (a comment, `<!-- -->`, is React's own). */
export function unescaped(body: string, payloads: readonly string[]): string[] {
  return payloads.filter((payload) => /<[a-z/?]/i.test(payload) && body.includes(payload));
}

export const verdict = (
  report: Report,
  name: string,
  response: Response2,
  payloads: readonly string[],
): void => {
  const raw = unescaped(response.body, payloads);
  const found = response.status < 500 ? violations(response.body) : [];
  report.check(
    'injection',
    name,
    response.status < 500 && raw.length === 0 && found.length === 0,
    response.status >= 500
      ? `status ${response.status}`
      : [...raw.map((payload) => `as typed: ${payload.slice(0, 40)}`), ...found]
          .slice(0, 4)
          .join('; ') || `status ${response.status}`,
  );
};

export async function checkInjection(platform: Platform, report: Report): Promise<void> {
  await withDatabase(platform, async (db) => {
    const category = String(
      (await db.query(`SELECT "categoryKey" FROM "Event" LIMIT 1`)).rows[0]?.categoryKey,
    );
    const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const author = persona('validator').login as string;

    // Somebody whose name is hostile: the members page, the author of an event, the profile.
    const colleague = (
      await db.query(
        `SELECT "id","fullName","photoUrl","campus" FROM "User" WHERE "login" = 'qa-colleague'`,
      )
    ).rows[0] as { id: string; fullName: string; photoUrl: string | null; campus: string | null };

    try {
      // --- stored -------------------------------------------------------------------------------------------------
      for (const [index, payload] of PAYLOADS.entries()) {
        const id = `${tag}-e${index}`;
        await db.query(
          `INSERT INTO "Event" ("id","title","description","location","categoryKey","status","startsAt","endsAt","schoolYear","authorLogin","proposedAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6::"EventStatus",$7::timestamp,$8::timestamp,'2026-2027',$9,$10::timestamp,now())`,
          [
            id,
            `${payload} ${tag}`,
            `${payload}\n${payload}`,
            payload,
            category,
            index % 2 === 0 ? 'CONFIRMED' : 'PROPOSED',
            `${day}T18:00:00`,
            `${day}T20:00:00`,
            index % 2 === 0 ? author : (persona('proposer').login as string),
            index % 2 === 0 ? null : `${day}T08:00:00`,
          ],
        );
        const roleId = `${tag}-r${index}`;
        await db.query(
          `INSERT INTO "Role" ("id","name","description","permissions","allPermissions","isDefault","updatedAt") VALUES ($1,$2,$3,'{events.view}',false,false,now())`,
          [roleId, `${payload} ${tag}${index}`, payload],
        );
        await db.query(
          `INSERT INTO "AuditLog" ("id","actorLogin","action","targetType","targetId","targetLabel","metadata") VALUES ($1,$2,'event.update','Event',$3,$4,$5::jsonb)`,
          [
            `${tag}-a${index}`,
            payload,
            id,
            payload,
            JSON.stringify({ comment: payload, note: [payload] }),
          ],
        );
      }
      await db.query(
        `UPDATE "User" SET "fullName" = $2, "photoUrl" = $3, "campus" = $4 WHERE "id" = $1`,
        [colleague.id, PAYLOADS[2], 'javascript:alert(1)', PAYLOADS[3]],
      );

      const stored: [string, string, 'owner' | 'validator' | 'member'][] = [
        ['the events, as a list', `/fr/events?view=list&month=${month}`, 'owner'],
        [
          'the events, as a calendar',
          `/fr/events?view=calendar&month=${month}&day=${day}`,
          'owner',
        ],
        ['the events, in English', `/en/events?view=list&month=${month}`, 'owner'],
        ['the events, as a member', `/fr/events?view=list&month=${month}`, 'member'],
        ['the proposals to validate', '/fr/events/review', 'validator'],
        ['the members', '/fr/members', 'owner'],
        ['the roles', '/fr/roles', 'owner'],
        ['the audit log', '/fr/audit-log', 'owner'],
        ['the dashboard', '/fr/dashboard', 'owner'],
      ];
      for (const [name, path, as] of stored) {
        verdict(report, `stored: ${name}`, await send(platform, path, { as }), PAYLOADS);
      }
      for (const index of [0, 1, 2, 3, 4, 7, 13]) {
        const id = `${tag}-e${index}`;
        for (const [name, path] of [
          ['an event', `/fr/events/${id}`],
          ['an event, to edit it', `/fr/events/${id}/edit`],
        ] as const) {
          verdict(
            report,
            `stored: ${name} (text n° ${index})`,
            await send(platform, path, { as: 'owner' }),
            PAYLOADS,
          );
        }
        verdict(
          report,
          `stored: a role (text n° ${index})`,
          await send(platform, `/fr/roles/${tag}-r${index}`, { as: 'owner' }),
          PAYLOADS,
        );
      }

      // The data a member downloads is JSON and says so: it cannot be opened as a page.
      const exported = await send(platform, '/api/me/export', { as: 'member' });
      report.check(
        'injection',
        'stored: the export is typed JSON and cannot be sniffed as a page',
        /^application\/json/.test(exported.headers.get('content-type') ?? '') &&
          exported.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff' &&
          /^attachment/.test(exported.headers.get('content-disposition') ?? ''),
        `${exported.headers.get('content-type')} / ${exported.headers.get('content-disposition')}`,
      );

      // The calendar download of an event.
      const modules = (
        await db.query(`SELECT config->'modules'->'enabled' AS enabled FROM "PlatformSettings"`)
      ).rows[0]?.enabled as string[] | undefined;
      const download = await send(platform, `/api/events/${tag}-e4/ics`, { as: 'owner' });
      report.check(
        'injection',
        'stored: the calendar file of an event is typed as one, and nothing in it is a page',
        // (with the events module off there is no such file: a 404, and nothing else)
        (!modules?.includes('events') && download.status === 404) ||
          (/^text\/calendar/.test(download.headers.get('content-type') ?? '') &&
            download.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff'),
        `${download.status} ${download.headers.get('content-type')}`,
      );

      // --- reflected ----------------------------------------------------------------------------------------------
      const reflected: [string, (payload: string) => string, 'owner' | 'member' | null][] = [
        [
          'the page of a sign-in that failed (campus)',
          (p) => `/fr/auth-error?reason=campus&campus=${encodeURIComponent(p)}`,
          null,
        ],
        [
          'the page of a sign-in that failed (reason, error)',
          (p) => `/fr/auth-error?reason=${encodeURIComponent(p)}&error=${encodeURIComponent(p)}`,
          null,
        ],
        [
          'the members after a removal',
          (p) => `/fr/members?removed=${encodeURIComponent(p)}`,
          'owner',
        ],
        ['the roles after a save', (p) => `/fr/roles?saved=${encodeURIComponent(p)}`, 'owner'],
        [
          'the events and their filters',
          (p) =>
            `/fr/events?view=${encodeURIComponent(p)}&month=${encodeURIComponent(p)}&day=${encodeURIComponent(p)}&category=${encodeURIComponent(p)}&assignee=${encodeURIComponent(p)}&schoolYear=${encodeURIComponent(p)}`,
          'owner',
        ],
        [
          'an event with a notice and a date',
          (p) =>
            `/fr/events/${tag}-e0?notice=${encodeURIComponent(p)}&occ=${encodeURIComponent(p)}`,
          'owner',
        ],
        [
          'the proposals with a notice',
          (p) => `/fr/events/review?notice=${encodeURIComponent(p)}`,
          'owner',
        ],
        [
          'the shared calendar with a status',
          (p) => `/fr/events/shared-calendar?status=${encodeURIComponent(p)}`,
          'owner',
        ],
        [
          'the new event with a date',
          (p) => `/fr/events/new?date=${encodeURIComponent(p)}`,
          'owner',
        ],
        ['an address that does not exist', (p) => `/fr/${encodeURIComponent(p)}`, 'owner'],
        ['an event that does not exist', (p) => `/fr/events/${encodeURIComponent(p)}`, 'owner'],
        [
          'the login page',
          (p) => `/fr?callbackUrl=${encodeURIComponent(p)}&error=${encodeURIComponent(p)}`,
          null,
        ],
      ];
      for (const [name, build, as] of reflected) {
        const bad: string[] = [];
        for (const payload of PAYLOADS) {
          const response = await send(platform, build(payload), as ? { as } : {});
          const found =
            response.status < 500 ? violations(response.body) : [`status ${response.status}`];
          if (unescaped(response.body, [payload]).length > 0) found.push('as typed');
          if (found.length > 0)
            bad.push(`${payload.slice(0, 30)} → ${found.slice(0, 2).join(', ')}`);
        }
        report.check(
          'injection',
          `reflected: ${name}, ${PAYLOADS.length} texts`,
          bad.length === 0,
          bad.slice(0, 3).join(' | '),
        );
      }

      // --- SQL ----------------------------------------------------------------------------------------------------
      const before = await snapshot(db);
      const bad: string[] = [];
      const started = Date.now();
      for (const payload of SQL_PAYLOADS) {
        for (const [, build, as] of reflected) {
          const response = await send(platform, build(payload), as ? { as } : {});
          if (response.status >= 500) bad.push(`${response.status} ${build(payload).slice(0, 50)}`);
        }
        const feed = await send(platform, `/api/calendar/${encodeURIComponent(payload)}`);
        if (feed.status >= 500) bad.push(`${feed.status} feed ${payload}`);
        const logo = await send(platform, `/api/logo?v=${encodeURIComponent(payload)}`);
        if (logo.status >= 500) bad.push(`${logo.status} logo ${payload}`);
      }
      const after = await snapshot(db);
      const changed = changedTables(before, after);
      report.check(
        'injection',
        'SQL: no address of the corpus is a server error',
        bad.length === 0,
        bad.slice(0, 3).join(' | '),
      );
      report.check(
        'injection',
        'SQL: nothing in the database changed',
        changed.length === 0,
        changed.join(', '),
      );
      report.check(
        'injection',
        'SQL: no `pg_sleep` took (the whole corpus answered in under a minute)',
        Date.now() - started < 60_000,
        `${Math.round((Date.now() - started) / 1000)} s`,
      );
      const tables = await db.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User'`,
      );
      report.check('injection', 'SQL: the table of users is still there', tables.rows[0]?.n === 1);
      const owners = await db.query(`SELECT count(*)::int AS n FROM "User" WHERE status = 'OWNER'`);
      report.check(
        'injection',
        'SQL: nobody became an owner',
        owners.rows[0]?.n === 1,
        String(owners.rows[0]?.n),
      );

      // --- where it goes, not what it says ------------------------------------------------------------------------
      const evil = 'evil.example';
      for (const [name, path, headers] of [
        ['a forged Host', '/fr', { host: evil }],
        ['a forged X-Forwarded-Host', '/fr', { 'x-forwarded-host': evil }],
        [
          'a forged X-Forwarded-Host on the sign-in page',
          '/api/auth/signin',
          { 'x-forwarded-host': evil },
        ],
        [
          'a forged X-Forwarded-Host and Proto on the sign-in page',
          '/api/auth/signin',
          { 'x-forwarded-host': evil, 'x-forwarded-proto': 'https' },
        ],
        ['a forged Forwarded header', '/fr', { forwarded: `host=${evil};proto=https` }],
        [
          'a forged X-Forwarded-Host on a page that needs a session',
          '/fr/dashboard',
          { 'x-forwarded-host': evil },
        ],
      ] as const) {
        const response = await send(platform, path, { headers });
        const location = response.headers.get('location') ?? '';
        report.check(
          'injection',
          `${name}: nothing sends the visitor, or the page's links, to another host`,
          !location.includes(evil) &&
            !response.body.includes(evil) &&
            !(redirectOf(response, platform) ?? '').includes(evil),
          `${response.status} ${location}`,
        );
      }
      // Open redirects: an address that makes the platform send somebody elsewhere.
      for (const target of [
        'https://evil.example',
        '//evil.example',
        '/\\evil.example',
        'https:evil.example',
        '%2f%2fevil.example',
        'javascript:alert(1)',
      ]) {
        for (const path of [
          `/api/auth/signin?callbackUrl=${encodeURIComponent(target)}`,
          `/api/auth/signout?callbackUrl=${encodeURIComponent(target)}`,
          `/fr?callbackUrl=${encodeURIComponent(target)}`,
          `/fr/dashboard?callbackUrl=${encodeURIComponent(target)}`,
          `/api/auth/callback/42-school?callbackUrl=${encodeURIComponent(target)}`,
        ]) {
          const response = await send(platform, path);
          const location = response.headers.get('location');
          const goes = location ? new URL(location, platform.base).host : null;
          report.check(
            'injection',
            `callbackUrl=${target} on ${path.split('?')[0]} stays on the platform`,
            response.status < 500 &&
              (goes === null ||
                (PLATFORM_HOSTS.has(new URL(`http://${goes}`).hostname) && !goes.includes(evil))) &&
              violations(response.body).length === 0,
            `${response.status} ${location ?? ''}`,
          );
        }
      }
      // The same, as the browser really does it: a POST with the token of the sign-in form, which is what a sign-out and
      // the start of a sign-in are. Where the answer leads, and what 42 is told to send the visitor back to.
      const csrf = await fetch(`${platform.base}/api/auth/csrf`);
      const { csrfToken } = (await csrf.json()) as { csrfToken: string };
      const csrfCookie = csrf.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ');
      const form = (fields: Record<string, string>) =>
        new URLSearchParams({ csrfToken, ...fields }).toString();
      for (const target of [
        'https://evil.example',
        '//evil.example',
        '/\\evil.example',
        'javascript:alert(1)',
      ]) {
        const out = await send(platform, '/api/auth/signout', {
          method: 'POST',
          cookie: csrfCookie,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({ callbackUrl: target }),
        });
        const location = out.headers.get('location');
        report.check(
          'injection',
          `a sign-out asked to go to ${target} stays on the platform`,
          out.status < 500 &&
            (!location || PLATFORM_HOSTS.has(new URL(location, platform.base).hostname)),
          `${out.status} ${location ?? ''}`,
        );
      }
      for (const [name, headers] of [
        ['as usual', {}],
        ['with a forged Host', { host: evil }],
        ['with a forged X-Forwarded-Host', { 'x-forwarded-host': evil }],
        ['with a forged Forwarded', { forwarded: `host=${evil}` }],
      ] as const) {
        const start = await send(platform, '/api/auth/signin/42-school', {
          method: 'POST',
          cookie: csrfCookie,
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
          body: form({ callbackUrl: 'https://evil.example/after' }),
        });
        const location = start.headers.get('location') ?? '';
        const redirectUri = (() => {
          try {
            return new URL(location).searchParams.get('redirect_uri') ?? '';
          } catch {
            return '';
          }
        })();
        report.check(
          'injection',
          `the start of a sign-in ${name} tells 42 to come back to the platform's address, and nowhere else`,
          start.status === 302 &&
            PLATFORM_HOSTS.has(new URL(redirectUri || 'http://none.invalid').hostname) &&
            !location.includes(evil),
          `${start.status} redirect_uri=${redirectUri}`,
        );
      }

      for (const path of [
        '//evil.example',
        '/\\evil.example',
        '/fr//evil.example',
        '/%2f%2fevil.example',
        '/fr/%2f%2fevil.example',
        '/fr/\\evil.example',
      ]) {
        const response = await send(platform, path);
        const location = response.headers.get('location');
        report.check(
          'injection',
          `the address ${path} does not redirect to another host`,
          response.status < 500 &&
            (!location || PLATFORM_HOSTS.has(new URL(location, platform.base).hostname)),
          `${response.status} ${location ?? ''}`,
        );
      }
    } finally {
      await db.query(`DELETE FROM "AuditLog" WHERE "id" LIKE $1`, [`${tag}-%`]);
      await db.query(`DELETE FROM "Event" WHERE "id" LIKE $1`, [`${tag}-%`]);
      await db.query(`DELETE FROM "Role" WHERE "id" LIKE $1`, [`${tag}-%`]);
      await db.query(
        `UPDATE "User" SET "fullName" = $2, "photoUrl" = $3, "campus" = $4 WHERE "id" = $1`,
        [colleague.id, colleague.fullName, colleague.photoUrl, colleague.campus],
      );
    }
  });
}
