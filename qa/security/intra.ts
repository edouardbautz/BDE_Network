import { randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { callAction, locate, readManifest } from '../access/actions-run';
import { changedTables, snapshot, withDatabase, type Platform } from '../access/http';
import { FIXTURES } from '../dataset';
import { persona } from '../personas';
import { Report, isNotFoundPage, send } from './core';
import { PAYLOADS, verdict } from './injection';

/**
 * What can be tried against the publication of the events on the intra: the text that reaches the staff's screen, the Markdown of a
 * description, the identifiers that end up in a message that pings, the link that the staff gives, and the actions called with
 * what a page would never send. Played only on a platform that publishes on the intra (`sh qa/platform.sh up --variant
 * events-intra`); on any other, the one thing to hold is that the pages do not exist.
 *
 *  - **stored**: hostile text in the title, the description, the place, the keywords, the copy the intra holds and the reason of a
 *    refusal, shown on the page of the request, on the list and on the page of the event;
 *  - **Markdown**: what the description may turn into (a link that runs, a picture that loads, a tag) is looked for in the page built
 *    like a browser would;
 *  - **identifiers**: the database itself refuses an id that is not the shape of a real one (a mention, `@everyone`, a role, a line
 *    break, a channel), and a link that is not an https address of the intra;
 *  - **forged actions**: a link, a version, a reason or a page to come back to that no page would send changes nothing.
 */

const tag = `sec${randomBytes(3).toString('hex')}`;

/** Markdown that tries to become something else: it must stay text, or a link that runs nothing. */
const MARKDOWN_PAYLOADS: readonly string[] = [
  // not hostile: an ordinary link must be drawn, and opened apart (the check below needs one to look at)
  '[a page](https://evil.example/page)',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](java\tscript:alert(1))',
  '[click](data:text/html,<script>alert(1)</script>)',
  '[click](vbscript:msgbox(1))',
  '![x](https://evil.example/x.png)',
  '![x](javascript:alert(1))',
  '[a](https://evil.example "t\' onmouseover=\'alert(1)")',
  '[a](<https://evil.example/ onclick=alert(1)>)',
  '**<img src=x onerror=alert(1)>**',
  '`<script>alert(1)</script>`',
  '> <script>alert(1)</script>',
  '# <svg/onload=alert(1)>',
  '- <a href="javascript:alert(1)">x</a>',
  '[' + '['.repeat(2000) + 'x](https://evil.example)',
  '*'.repeat(5000),
  '> '.repeat(500) + 'x',
  '- '.repeat(500) + 'x',
];

/** What a description turned into Markdown must not contain: found by building the page like a browser. */
export function markdownViolations(html: string): string[] {
  const found: string[] = [];
  const document = new JSDOM(html).window.document;
  for (const link of document.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    // A link the platform did not write is an address of the web or a mail address, opened in a tab that knows nothing of the platform.
    if (/^\s*(javascript|data|vbscript|file|blob):/i.test(href))
      found.push(`<a href="${href.slice(0, 30)}">`);
    if (/^https?:/i.test(href) && href.includes('evil.example')) {
      const rel = link.getAttribute('rel') ?? '';
      if (!/noopener/.test(rel) || link.getAttribute('target') !== '_blank') {
        found.push('a link to another site that is not opened apart');
      }
    }
  }
  for (const image of document.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    // The logo and the avatars are the platform's: a picture from elsewhere is not.
    if (/evil\.example|^javascript:/i.test(src)) found.push(`<img src="${src.slice(0, 30)}">`);
  }
  return found;
}

const HEX = 'c'.repeat(64);

export async function checkIntra(platform: Platform, report: Report): Promise<void> {
  const list = await send(platform, '/fr/events/intra', { as: 'owner' });
  if (isNotFoundPage(list)) {
    // Not publishing on the intra: nothing exists, for the staff and for the owner alike.
    for (const as of ['staff', 'owner'] as const) {
      const page = await send(platform, `/fr/events/intra/${FIXTURES.events.intraPending}`, { as });
      const root = await send(platform, '/fr/events/intra', { as });
      report.check(
        'intra',
        `the pages of the intra do not exist while the platform does not publish there (${as})`,
        isNotFoundPage(page) && isNotFoundPage(root),
        `${root.status} / ${page.status}`,
      );
    }
    return;
  }

  const manifest = readManifest();
  const author = persona('validator').login as string;

  await withDatabase(platform, async (db) => {
    const category = String(
      (await db.query(`SELECT "categoryKey" FROM "Event" LIMIT 1`)).rows[0]?.categoryKey,
    );
    const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const staff = (await db.query(`SELECT "id" FROM "User" WHERE "login" = 'qa-staff'`))
      .rows[0] as {
      id: string;
    };
    const ids: string[] = [];

    /** An event published to the intra with the text asked for in every field a member or the staff writes. */
    async function insert(id: string, text: string, state: number, description = text) {
      ids.push(id);
      await db.query(
        `INSERT INTO "Event" ("id","title","description","location","categoryKey","status","startsAt","endsAt","schoolYear","authorLogin","updatedAt",
           "intraOrganizerLogin","intraAudience","intraMaxPeople","intraWaitingList","intraKind","intraUnsubscribeHours","intraKeywords")
         VALUES ($1,$2,$3,$4,$5,'CONFIRMED',$6::timestamp,$7::timestamp,'2026-2027',$8,now(),$9,'BOTH',50,true,'Association',24,ARRAY[$10]::text[])`,
        [
          id,
          `${text} ${tag}`,
          description,
          text,
          category,
          `${day}T18:00:00`,
          `${day}T20:00:00`,
          author,
          author,
          text.slice(0, 30),
        ],
      );
      const published = {
        title: `${text} (earlier)`,
        description: text,
        location: text,
        fields: {
          organizerLogin: author,
          audience: 'BOTH',
          maxPeople: 50,
          waitingList: true,
          kind: 'Association',
          unsubscribeHours: 24,
          keywords: [text.slice(0, 30)],
        },
        dates: [
          {
            start: `${day}T16:00:00.000Z`,
            end: `${day}T18:00:00.000Z`,
            title: text,
            description: text,
            location: text,
          },
        ],
      };
      const status = ['PENDING', 'PUBLISHED', 'OUTDATED', 'REFUSED'][state % 4]!;
      const onIntra = status === 'PUBLISHED' || status === 'OUTDATED';
      await db.query(
        `INSERT INTO "IntraRequest" ("id","eventId","status","contentHash","publishedContent","publishedAt","refusalComment","requestedAt","requestedByLogin","answeredAt","answeredByLogin","answeredById","createdAt","updatedAt")
         VALUES ($1,$2,$3::"IntraRequestStatus",$4,$5::jsonb,$6,$7,now(),$8,$9,$10,$11,now(),now())`,
        [
          `${id}-req`,
          id,
          status,
          HEX,
          onIntra ? JSON.stringify(published) : null,
          onIntra ? new Date() : null,
          status === 'REFUSED' ? text : null,
          author,
          status === 'PENDING' ? null : new Date(),
          status === 'PENDING' ? null : 'qa-staff',
          status === 'PENDING' ? null : staff.id,
        ],
      );
    }

    try {
      // --- stored text -------------------------------------------------------------------------------------------------
      for (const [index, payload] of PAYLOADS.entries())
        await insert(`${tag}-i${index}`, payload, index);
      for (const [index, payload] of MARKDOWN_PAYLOADS.entries()) {
        await insert(`${tag}-m${index}`, 'Markdown', index, payload);
      }

      verdict(
        report,
        'intra: the list of requests, as the staff',
        await send(platform, '/fr/events/intra', { as: 'staff' }),
        PAYLOADS,
      );
      verdict(
        report,
        'intra: the list of requests, in English, as the owner',
        await send(platform, '/en/events/intra', { as: 'owner' }),
        PAYLOADS,
      );
      for (const index of PAYLOADS.keys()) {
        const id = `${tag}-i${index}`;
        verdict(
          report,
          `intra: the page of a request (text n° ${index}), as the staff`,
          await send(platform, `/fr/events/intra/${id}`, { as: 'staff' }),
          PAYLOADS,
        );
        verdict(
          report,
          `intra: the page of an event with its publication (text n° ${index}), as the owner`,
          await send(platform, `/fr/events/${id}`, { as: 'owner' }),
          PAYLOADS,
        );
      }

      // --- Markdown --------------------------------------------------------------------------------------------------
      const bad: string[] = [];
      for (const [index, source] of MARKDOWN_PAYLOADS.entries()) {
        const id = `${tag}-m${index}`;
        for (const [where, path, as] of [
          ['the event', `/fr/events/${id}`, 'owner'],
          ['the request', `/fr/events/intra/${id}`, 'staff'],
        ] as const) {
          const response = await send(platform, path, { as });
          const found =
            response.status < 500
              ? markdownViolations(response.body)
              : [`status ${response.status}`];
          if (found.length > 0)
            bad.push(`${source.slice(0, 30)} (${where}) → ${found.slice(0, 2).join(', ')}`);
        }
      }
      report.check(
        'intra',
        'a Markdown description never becomes a link that runs, a picture from elsewhere or a tag',
        bad.length === 0,
        bad.slice(0, 3).join('; ') || `${MARKDOWN_PAYLOADS.length} descriptions, 2 pages each`,
      );

      // --- identifiers: what the database refuses --------------------------------------------------------------------------
      const refused = async (statement: string, value: string): Promise<boolean> => {
        await db.query('BEGIN');
        try {
          await db.query(statement, [value]);
          return false;
        } catch {
          return true;
        } finally {
          await db.query('ROLLBACK');
        }
      };
      const DISCORD = [
        '@everyone',
        '@here',
        '<@123456789012345678>',
        '<@&123456789012345678>',
        '123456789012345678\n',
        ' 123456789012345678',
        '12345678901234',
        '1234567890123456789012',
        'everyone',
        "1' OR '1'='1",
        '١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨',
        '123456789012345678; DROP TABLE "User"',
      ];
      const SLACK = [
        '@channel',
        '<!channel>',
        '<@U04ABCD1234>',
        'C04ABCD1234',
        'u04abcd1234',
        'U04ABCD1234\n',
        'U1',
        'U04ABCD1234567890',
        'S04ABCD1234',
        '*',
      ];
      // one after the other: they share a connection and each is a transaction of its own
      const accepted: string[] = [];
      for (const value of DISCORD) {
        if (
          !(await refused(
            `UPDATE "User" SET "discordUserId" = $1 WHERE "login" = 'qa-member'`,
            value,
          ))
        ) {
          accepted.push(`discord: ${JSON.stringify(value)}`);
        }
      }
      for (const value of SLACK) {
        if (
          !(await refused(
            `UPDATE "User" SET "slackUserId" = $1 WHERE "login" = 'qa-member'`,
            value,
          ))
        ) {
          accepted.push(`slack: ${JSON.stringify(value)}`);
        }
      }
      report.check(
        'intra',
        'an id that is not the shape of a real Discord or Slack id is refused by the database (a mention, @everyone, a channel, a line break)',
        accepted.length === 0,
        accepted.join('; ') || `${DISCORD.length + SLACK.length} refused`,
      );

      const URLS = [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'http://profile.intra.42.fr/events/1',
        'https://evil.example/intra.42.fr',
        'https://intra.42.fr.evil.example/',
        'https://evilintra.42.fr/',
        'https://user:pass@profile.intra.42.fr/',
        'https://profile.intra.42.fr:8443/',
        'https://profile.intra.42.fr/a b',
        'https://profile.intra.42.fr/"><script>',
        `https://profile.intra.42.fr/${'a'.repeat(400)}`,
      ];
      const published = `${tag}-i1-req`;
      const taken: string[] = [];
      for (const url of URLS) {
        if (
          !(await refused(
            `UPDATE "IntraRequest" SET "intraUrl" = $1 WHERE "id" = '${published}'`,
            url,
          ))
        ) {
          taken.push(url);
        }
      }
      report.check(
        'intra',
        'a link that is not an https address of the intra is refused by the database',
        taken.length === 0,
        taken.join('; ') || `${URLS.length} refused`,
      );

      // --- forged actions -------------------------------------------------------------------------------------------------
      const publish = locate(manifest, 'intra.publishOnIntra');
      const refuse = locate(manifest, 'intra.refuseOnIntra');
      const request = locate(manifest, 'intra.requestOnIntra');
      const pending = FIXTURES.events.intraPending;
      const hash = String(
        (await db.query(`SELECT "contentHash" FROM "IntraRequest" WHERE "eventId" = $1`, [pending]))
          .rows[0]?.contentHash,
      );

      const forged: [string, () => Promise<{ status: number }>][] = [
        [
          'a link that runs a script',
          () =>
            callAction(platform, 'staff', publish.id, publish.page, [
              pending,
              hash,
              'javascript:alert(1)',
            ]),
        ],
        [
          'a link to another site that looks like the intra',
          () =>
            callAction(platform, 'staff', publish.id, publish.page, [
              pending,
              hash,
              'https://evil.example/intra.42.fr',
            ]),
        ],
        [
          'a version that is not a hash',
          () =>
            callAction(platform, 'staff', publish.id, publish.page, [pending, "' OR '1'='1", '']),
        ],
        [
          'a version that is not text',
          () => callAction(platform, 'staff', publish.id, publish.page, [pending, { hash }, '']),
        ],
        [
          'an event that is not an identifier',
          () =>
            callAction(platform, 'staff', publish.id, publish.page, ['x'.repeat(5000), hash, '']),
        ],
        [
          'a refusal with no reason',
          () => callAction(platform, 'staff', refuse.id, refuse.page, [pending, '   ']),
        ],
        [
          'a refusal with a reason of 100 000 characters',
          () =>
            callAction(platform, 'staff', refuse.id, refuse.page, [pending, 'x'.repeat(100_000)]),
        ],
        [
          'a request sent from a page that is an address of another site',
          () =>
            callAction(platform, 'validator', request.id, request.page, [
              FIXTURES.events.intraRefused,
              'https://evil.example',
            ]),
        ],
        [
          'a request sent from a page that is a path of the platform',
          () =>
            callAction(platform, 'validator', request.id, request.page, [
              FIXTURES.events.intraRefused,
              '/api/health',
            ]),
        ],
        [
          'an answer by somebody who does not hold the right (a member, a proposer, a validator)',
          async () => {
            const calls = await Promise.all(
              (['member', 'proposer', 'validator'] as const).map((who) =>
                callAction(platform, who, publish.id, publish.page, [pending, hash, '']),
              ),
            );
            return { status: Math.min(...calls.map((call) => call.status)) };
          },
        ],
      ];
      for (const [name, play] of forged) {
        const before = await snapshot(db);
        const call = await play();
        const changed = changedTables(before, await snapshot(db));
        report.check(
          'intra',
          `forged: ${name} is refused and changes nothing`,
          call.status >= 400 && changed.length === 0,
          `status ${call.status}${changed.length ? `, changed ${changed.join(', ')}` : ''}`,
        );
      }

      // The control: with what the page sends, the same action works (so that the refusals above mean something).
      const before = await snapshot(db);
      const control = await callAction(platform, 'staff', publish.id, publish.page, [
        pending,
        hash,
        'https://profile.intra.42.fr/events/777',
      ]);
      const status = String(
        (await db.query(`SELECT "status" FROM "IntraRequest" WHERE "eventId" = $1`, [pending]))
          .rows[0]?.status,
      );
      report.check(
        'intra',
        'with the version the page showed and an address of the intra, the staff’s answer works (the refusals above mean something)',
        control.status < 400 &&
          status === 'PUBLISHED' &&
          changedTables(before, await snapshot(db)).includes('IntraRequest'),
        `status ${control.status}, request ${status}`,
      );
      await db.query(
        `UPDATE "IntraRequest" SET "status" = 'PENDING', "publishedContent" = NULL, "publishedAt" = NULL, "intraUrl" = NULL, "answeredAt" = NULL, "answeredByLogin" = NULL, "answeredById" = NULL WHERE "eventId" = $1`,
        [pending],
      );
    } finally {
      for (const id of ids) await db.query(`DELETE FROM "Event" WHERE "id" = $1`, [id]);
    }
  });
}
