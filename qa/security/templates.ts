import { randomBytes } from 'node:crypto';
import { callAction, locate, readManifest } from '../access/actions-run';
import { changedTables, snapshot, withDatabase, type Platform } from '../access/http';
import { Report, send } from './core';
import { PAYLOADS, unescaped, violations } from './injection';

/**
 * The templates of the notifications, attacked. Three things are played with the corpus of hostile text of the injection suite:
 *
 *  - **stored**: a template (and a name in the directory of mentions) full of hostile text is in the database, as a save, a restore
 *    or an older version would have put it, and the page where it is edited is opened as the owner: nothing may come out as a tag the
 *    browser would build, and the page must still work;
 *  - **drawn**: the same text goes through the preview of every channel (the server draws it with the code that draws the real
 *    notification) and none may fail. The e-mail, which is HTML built by the server, is read like a browser would read it and must
 *    hold no tag the text made, no handler, no `javascript:` address and nothing that loads from elsewhere;
 *  - **forged**: the action that writes a template, called from another site, writes nothing.
 *
 * What a person writes in a template on purpose (a link in the button, a mention) is not an attack and is not played here: the
 * unit tests hold that to the byte.
 */

const EVIL = 'https://evil.example';
const tag = `tpl${randomBytes(3).toString('hex')}`;

const DOCUMENT = /<!doctype html>[\s\S]*?<\/html>/gi;

/**
 * The e-mail documents in the answer of a server action. A long string travels either as a JSON string of a row (with its
 * escapes) or as a text row of its own, raw: both are looked for, and the first is decoded.
 */
export function documentsOf(body: string): string[] {
  return [...body.matchAll(DOCUMENT)].map(([found]) => {
    if (!found.includes('\\n') && !found.includes('\\"')) return found;
    try {
      return JSON.parse(`"${found}"`) as string;
    } catch {
      return found;
    }
  });
}

export async function checkTemplates(platform: Platform, report: Report): Promise<void> {
  const manifest = readManifest();
  const preview = locate(manifest, 'notifications.previewTemplate');
  const save = locate(manifest, 'notifications.saveTemplate');

  await withDatabase(platform, async (db) => {
    const clean = async () => {
      await db.query(`DELETE FROM "NotificationTemplateVersion"`);
      await db.query(`DELETE FROM "NotificationTemplate"`);
      await db.query(`DELETE FROM "NotificationMention"`);
    };
    await clean();

    try {
      // --- stored ---------------------------------------------------------------------------------------------------
      for (const [index, payload] of PAYLOADS.entries()) {
        await db.query(
          `INSERT INTO "NotificationMention" ("id","key","platform","kind","label","externalId","createdByLogin") VALUES ($1,$2,'discord','role',$3,'123456789012345678','qa-owner')`,
          [`${tag}-m${index}`, `${tag}-${index}`, payload],
        );
      }
      for (const [index, payload] of PAYLOADS.entries()) {
        const content = {
          eyebrow: payload,
          title: payload,
          footer: payload,
          above: payload,
          button: { enabled: true, label: payload, url: payload },
          items: {
            order: 'custom',
            list: [
              { id: 'summary', enabled: true, text: payload },
              { id: 'login', enabled: true, label: payload, emoji: payload },
              { id: `text:${tag.slice(3, 9)}`, enabled: true, text: payload },
            ],
          },
        };
        await db.query(
          `INSERT INTO "NotificationTemplate" ("id","type","scope","content","version","basedOnRevision","updatedAt","updatedByLogin") VALUES ($1,'memberPending','all',$2::jsonb,1,1,now(),$3)
           ON CONFLICT ("type","scope") DO UPDATE SET "content" = EXCLUDED."content"`,
          [`${tag}-t`, JSON.stringify(content), payload],
        );
        for (const scope of ['all', 'slack'] as const) {
          const response = await send(
            platform,
            `/fr/notifications?type=memberPending&scope=${scope}`,
            { as: 'owner' },
          );
          const raw = unescaped(response.body, PAYLOADS);
          const found = response.status < 500 ? violations(response.body) : [];
          report.check(
            'templates',
            `stored: the page of a template full of text n° ${index}, tab ${scope}`,
            response.status < 500 && raw.length === 0 && found.length === 0,
            response.status >= 500
              ? `status ${response.status}`
              : [...raw.map((p) => `as typed: ${p.slice(0, 40)}`), ...found]
                  .slice(0, 3)
                  .join('; ') || `status ${response.status}`,
          );
        }
        await db.query(`DELETE FROM "NotificationTemplate" WHERE "id" = $1`, [`${tag}-t`]);
      }

      // --- drawn ----------------------------------------------------------------------------------------------------
      const bad: string[] = [];
      for (const payload of PAYLOADS) {
        const drafts = {
          all: {
            eyebrow: payload,
            title: payload,
            footer: payload,
            items: {
              order: 'custom',
              list: [
                { id: 'summary', enabled: true, text: payload },
                { id: 'login', enabled: true, label: payload },
                { id: `text:${tag.slice(3, 9)}`, enabled: true, text: payload },
              ],
            },
          },
          own: null,
        };
        for (const channel of ['discord', 'slack', 'email'] as const) {
          const call = await callAction(platform, 'owner', preview.id, preview.page, [
            { type: 'memberPending', channel, drafts },
          ]);
          if (call.status >= 500) {
            bad.push(`${channel} ${call.status}`);
            continue;
          }
          // What a Discord card or a Slack message holds is data: the text as typed, which the page draws as text (React escapes it, and
          // the stored case above reads the page). The e-mail is HTML, built by the server: that is what must hold nothing.
          for (const html of documentsOf(call.text)) {
            if (unescaped(html, [payload]).length > 0) {
              bad.push(`email: ${payload.slice(0, 30)} as typed`);
            }
            const found = violations(html);
            if (found.length > 0) bad.push(`email: ${found.slice(0, 2).join(', ')}`);
          }
        }
      }
      report.check(
        'templates',
        `drawn: the preview of every channel answers for ${PAYLOADS.length} hostile texts, and the e-mail holds none of them as markup`,
        bad.length === 0,
        bad.slice(0, 3).join(' | '),
      );

      // --- forged ---------------------------------------------------------------------------------------------------
      const input = {
        type: 'memberPending',
        scope: 'all',
        content: { eyebrow: 'written by the attacks' },
        expectedVersion: 0,
      };
      await clean();
      const own = await callAction(platform, 'owner', save.id, save.page, [input], {
        origin: platform.base,
      });
      const written = Number(
        (await db.query(`SELECT count(*)::int AS n FROM "NotificationTemplate"`)).rows[0]?.n,
      );
      report.check(
        'templates',
        'forged: from its own origin the action writes a template (the cases below mean something)',
        own.status < 400 && written === 1,
        `status ${own.status}, ${written} written`,
      );
      for (const [name, origin] of [
        ['another site', EVIL],
        ['"null" (a sandboxed frame)', 'null'],
      ] as const) {
        await clean();
        const snap = await snapshot(db);
        const call = await callAction(platform, 'owner', save.id, save.page, [input], { origin });
        const changed = changedTables(snap, await snapshot(db));
        report.check(
          'templates',
          `forged: writing a template from ${name} is refused and changes nothing`,
          call.status >= 400 && changed.length === 0,
          `status ${call.status}${changed.length ? `, changed ${changed.join(', ')}` : ''}`,
        );
      }

      // A save from somebody who may not write templates changes nothing either, whatever they send.
      for (const who of ['member', 'validator', 'custom'] as const) {
        await clean();
        const snap = await snapshot(db);
        const call = await callAction(platform, who, save.id, save.page, [input]);
        const changed = changedTables(snap, await snapshot(db));
        report.check(
          'templates',
          `${who} cannot write a template, and nothing changes`,
          call.status >= 400 && changed.length === 0,
          `status ${call.status}${changed.length ? `, changed ${changed.join(', ')}` : ''}`,
        );
      }
    } finally {
      await clean();
    }
  });
}
