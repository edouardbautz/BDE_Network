import type { Platform } from '../access/http';
import { changedTables, snapshot, withDatabase } from '../access/http';
import { callAction, locate, readManifest } from '../access/actions-run';
import { Report, send } from './core';
import { cookieHeaderFor, persona } from '../personas';

/**
 * Cross-site request forgery: a page of another site makes the browser of a signed-in member send a request, cookie
 * included. A server action is a POST with a header that a form cannot set, and Next.js also compares the `Origin` of
 * the request with the host. What is played here is what such a page could do: an action called from another origin,
 * through `fetch` and through a plain HTML form (the "progressive" way, with the id of the action in a field).
 */

const EVIL = 'https://evil.example';

export async function checkCsrf(platform: Platform, report: Report): Promise<void> {
  const manifest = readManifest();
  // One action that changes something of the signed-in member and needs no argument: their own calendar link.
  const { id, page } = locate(manifest, 'profile.regenerateMyCalendarToken');
  const tokenOf = async (db: {
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  }) =>
    String(
      (await db.query(`SELECT "calendarToken" FROM "User" WHERE "login" = 'qa-member'`)).rows[0]
        ?.calendarToken,
    );

  await withDatabase(platform, async (db) => {
    // The control: from the platform's own origin, it works (so a refusal below means something).
    const before = await tokenOf(db);
    const own = await callAction(platform, 'member', id, page, [], { origin: platform.base });
    const afterOwn = await tokenOf(db);
    report.check(
      'csrf',
      'from its own origin, the action works (the cases below mean something)',
      own.status < 400 && afterOwn !== before,
      `status ${own.status}`,
    );

    for (const [name, origin] of [
      ['another site', EVIL],
      ['a site whose name contains the platform’s', `${platform.base}.evil.example`],
      ['the same host on another port', platform.base.replace(/:\d+$/, ':9999')],
      ['"null" (a sandboxed frame, a local file)', 'null'],
    ] as const) {
      const beforeCall = await tokenOf(db);
      const snap = await snapshot(db);
      const call = await callAction(platform, 'member', id, page, [], { origin });
      const changed = changedTables(snap, await snapshot(db));
      report.check(
        'csrf',
        `a server action called from ${name} is refused and changes nothing`,
        call.status >= 400 && changed.length === 0 && (await tokenOf(db)) === beforeCall,
        `status ${call.status}${changed.length ? `, changed ${changed.join(', ')}` : ''}`,
      );
    }

    // A plain HTML form on another site: multipart, the id of the action in a field, the cookie riding along.
    const cookie = await cookieHeaderFor(persona('member'), platform.secret);
    const form = (origin: string) => {
      const data = new FormData();
      data.append(`$ACTION_ID_${id}`, '');
      return send(platform, page, {
        method: 'POST',
        headers: { origin, ...(cookie ? { cookie } : {}) },
        body: data,
      });
    };
    const tokenBefore = await tokenOf(db);
    const forged = await form(EVIL);
    report.check(
      'csrf',
      'a form on another site, with the action in a field, is refused',
      forged.status >= 400 && (await tokenOf(db)) === tokenBefore,
      `status ${forged.status}`,
    );

    const tokenBeforeOwn = await tokenOf(db);
    const same = await form(platform.base);
    report.check(
      'csrf',
      'the same form from the platform’s own origin works (the case above means something)',
      same.status < 400 && (await tokenOf(db)) !== tokenBeforeOwn,
      `status ${same.status}`,
    );

    // A GET never changes anything: the address of an action opened in a tab does nothing.
    const beforeGet = await tokenOf(db);
    const get = await send(platform, page, { as: 'member', headers: { 'next-action': id } });
    report.check(
      'csrf',
      'a GET carrying the id of an action does nothing',
      (await tokenOf(db)) === beforeGet && get.status < 500,
      `status ${get.status}`,
    );
  });
}
