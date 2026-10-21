import type { Platform } from '../access/http';
import { changedTables, snapshot, withDatabase } from '../access/http';
import { callAction, locate, readManifest } from '../access/actions-run';
import { FIXTURES } from '../dataset';
import { Report, send } from './core';
import { cookieHeaderFor, persona } from '../personas';

/**
 * Cross-site request forgery: a page of another site makes the browser of a signed-in person send a request, cookie
 * included. A server action is a POST with a header that a form cannot set, and Next.js also compares the `Origin` of
 * the request with the host. What is played here is what such a page could do: an action called from another origin,
 * through `fetch` and, where an action takes no argument, through a plain HTML form (the "progressive" way, with the
 * id of the action in a field).
 *
 * The action of the fetch cases is the owner giving a member a role (it exists whatever the modules): the control (from
 * the platform's own origin it works) and every refusal (the member keeps the role they had, nothing is written).
 */

const EVIL = 'https://evil.example';
const { leaver } = FIXTURES.accounts;

export async function checkCsrf(platform: Platform, report: Report): Promise<void> {
  const manifest = readManifest();
  const change = locate(manifest, 'members.changeMemberRole');

  await withDatabase(platform, async (db) => {
    const roleOf = async () =>
      String(
        (await db.query(`SELECT "roleId" FROM "User" WHERE "id" = $1`, [leaver.id])).rows[0]
          ?.roleId,
      );
    const reset = () =>
      db.query(
        `UPDATE "User" SET "roleId" = (SELECT "id" FROM "Role" WHERE "isDefault") WHERE "id" = $1`,
        [leaver.id],
      );
    const give = (origin: string) =>
      callAction(platform, 'owner', change.id, change.page, [leaver.id, FIXTURES.spareRole], {
        origin,
      });

    // The control: from the platform's own origin, it works (so a refusal below means something).
    await reset();
    const start = await roleOf();
    const own = await give(platform.base);
    report.check(
      'csrf',
      'from its own origin, the action works (the cases below mean something)',
      own.status < 400 && (await roleOf()) === FIXTURES.spareRole,
      `status ${own.status}`,
    );

    for (const [name, origin] of [
      ['another site', EVIL],
      ['a site whose name contains the platform’s', `${platform.base}.evil.example`],
      ['the same host on another port', platform.base.replace(/:\d+$/, ':9999')],
      ['"null" (a sandboxed frame, a local file)', 'null'],
    ] as const) {
      await reset();
      const snap = await snapshot(db);
      const call = await give(origin);
      const changed = changedTables(snap, await snapshot(db));
      report.check(
        'csrf',
        `a server action called from ${name} is refused and changes nothing`,
        call.status >= 400 && changed.length === 0 && (await roleOf()) === start,
        `status ${call.status}${changed.length ? `, changed ${changed.join(', ')}` : ''}`,
      );
    }
    await reset();

    // A GET never changes anything: the address of an action opened in a tab does nothing.
    const snap = await snapshot(db);
    const get = await send(platform, change.page, {
      as: 'owner',
      headers: { 'next-action': change.id },
    });
    report.check(
      'csrf',
      'a GET carrying the id of an action does nothing',
      changedTables(snap, await snapshot(db)).length === 0 && get.status < 500,
      `status ${get.status}`,
    );

    // A plain HTML form on another site: multipart, the id of the action in a field, the cookie riding along. Only an action
    // that takes no argument can be a plain form: one's own calendar link (it exists with the events module).
    const modules = (
      await db.query(`SELECT config->'modules'->'enabled' AS enabled FROM "PlatformSettings"`)
    ).rows[0]?.enabled as string[] | undefined;
    if (!modules?.includes('events')) return;

    const { id, page } = locate(manifest, 'profile.regenerateMyCalendarToken');
    const tokenOf = async () =>
      String(
        (await db.query(`SELECT "calendarToken" FROM "User" WHERE "login" = 'qa-member'`)).rows[0]
          ?.calendarToken,
      );
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
    const tokenBefore = await tokenOf();
    const forged = await form(EVIL);
    report.check(
      'csrf',
      'a form on another site, with the action in a field, is refused',
      forged.status >= 400 && (await tokenOf()) === tokenBefore,
      `status ${forged.status}`,
    );

    const tokenBeforeOwn = await tokenOf();
    const same = await form(platform.base);
    report.check(
      'csrf',
      'the same form from the platform’s own origin works (the case above means something)',
      same.status < 400 && (await tokenOf()) !== tokenBeforeOwn,
      `status ${same.status}`,
    );
  });
}
