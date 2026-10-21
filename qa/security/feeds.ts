import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import { callAction, locate, readManifest } from '../access/actions-run';
import { withDatabase, type Platform } from '../access/http';
import { persona } from '../personas';
import { Report, send, type Response2 } from './core';

/**
 * The calendar links: a secret in an address is the only thing that protects them. What is played here: a guess is
 * never told from another (the same bare answer for everything that is wrong), a revoked link stops at once, a link
 * of one kind opens nothing of the other, a draft never leaves through a feed that must not hold one, and what a
 * member typed into an event cannot add lines of its own to the calendar file.
 */

const BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const tag = `sec${randomBytes(3).toString('hex')}`;

/** The properties the platform writes: any other name at the start of a line was put there by somebody. */
const ALLOWED_PROPERTIES =
  /^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|X-WR-CALNAME|X-WR-TIMEZONE|REFRESH-INTERVAL|X-PUBLISHED-TTL|UID|DTSTAMP|DTSTART|DTEND|SUMMARY|DESCRIPTION|LOCATION|CATEGORIES|STATUS|SEQUENCE|TRANSP|RECURRENCE-ID|RRULE|EXDATE|CREATED|LAST-MODIFIED)$/;

/** What of an answer must be identical for every wrong guess. */
const fingerprint = (response: Response2) =>
  JSON.stringify([
    response.status,
    response.body,
    response.headers.get('content-type'),
    response.headers.get('cache-control'),
    response.headers.get('content-length'),
  ]);

/** The lines of a calendar file, folded lines joined (RFC 5545: a line that starts with a space continues the last). */
export function unfold(ics: string): string[] {
  return ics.split('\r\n').reduce<string[]>((lines, line) => {
    if (/^[ \t]/.test(line) && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
    return lines;
  }, []);
}

const tokenOf = async (db: Client, login: string) =>
  String(
    (await db.query(`SELECT "calendarToken" FROM "User" WHERE "login" = $1`, [login])).rows[0]
      ?.calendarToken,
  );

export async function checkFeeds(platform: Platform, report: Report): Promise<void> {
  await withDatabase(platform, async (db) => {
    const memberToken = await tokenOf(db, persona('member').login as string);
    const validatorToken = await tokenOf(db, persona('validator').login as string);
    const feed = (token: string) => send(platform, `/api/calendar/${token}`);

    report.watch('a member’s calendar link', memberToken);
    report.watch('a validator’s calendar link', validatorToken);
    const own = await feed(memberToken);
    if (own.status === 404) {
      // The module is switched off: a feed that is there would be the bug.
      const bde = await send(
        platform,
        `/api/calendar/bde/${randomBytes(32).toString('base64url')}`,
      );
      report.check(
        'feeds',
        'with the events module off, a member’s link is a 404 like any other',
        fingerprint(own) === fingerprint(bde),
      );
      return;
    }

    // The answer to the right token.
    report.check(
      'feeds',
      'a member’s link answers a calendar',
      own.status === 200 &&
        /^text\/calendar/.test(own.headers.get('content-type') ?? '') &&
        own.body.startsWith('BEGIN:VCALENDAR'),
      `${own.status} ${own.headers.get('content-type')}`,
    );
    report.check(
      'feeds',
      'the answer is never kept and never indexed',
      /no-store/.test(own.headers.get('cache-control') ?? '') &&
        /noindex/.test(own.headers.get('x-robots-tag') ?? ''),
      `${own.headers.get('cache-control')} / ${own.headers.get('x-robots-tag')}`,
    );
    report.check(
      'feeds',
      'the secret is not written in the file it opens',
      !own.body.includes(memberToken),
    );
    const suffixed = await feed(`${memberToken}.ics`);
    report.check(
      'feeds',
      'the link with the “.ics” the clients add works',
      suffixed.status === 200,
    );

    // Every wrong guess is the same answer.
    const reference = fingerprint(await feed(randomBytes(32).toString('base64url')));
    const guesses = Array.from({ length: 300 }, () => randomBytes(32).toString('base64url'));
    const answers = new Set<string>();
    for (const guess of guesses) answers.add(fingerprint(await feed(guess)));
    report.check(
      'feeds',
      '300 random links: one and the same bare 404, whatever the guess',
      answers.size === 1 && answers.has(reference) && reference.startsWith('[404'),
      `${answers.size} different answers`,
    );

    const near: [string, string][] = [
      [
        'the right link with one character changed',
        `${memberToken.slice(0, 20)}${memberToken[20] === 'a' ? 'b' : 'a'}${memberToken.slice(21)}`,
      ],
      ['the right link, shortened by one character', memberToken.slice(0, -1)],
      ['the right link and one more character', `${memberToken}a`],
      ['the right link in upper case', memberToken.toUpperCase()],
      ['the right link with a space after', `${memberToken}%20`],
      ['the right link with another extension', `${memberToken}.html`],
      ['an SQL fragment', `${encodeURIComponent("' OR '1'='1")}`],
      [
        'an SQL fragment that closes a string and a statement',
        encodeURIComponent('x\'; DROP TABLE "User"; --'),
      ],
      ['a wildcard', '%25'],
      ['an underscore wildcard', '_'.repeat(43)],
      ['a null byte', `${memberToken}%00`],
      ['dots and slashes', '..%2f..%2f..%2fetc%2fpasswd'],
      ['an emoji', encodeURIComponent('😀'.repeat(20))],
      ['a line break', `${memberToken}%0d%0aSet-Cookie:%20x=1`],
      ['the word “bde”', 'bde'],
    ];
    // What the server answers before the route is reached: a redirect to the address without the slash, the page of
    // an unknown address, the refusal of a header line that is too long. None of them is the feed, none a server error.
    for (const [name, value] of [
      ['the right link with a slash after', `${memberToken}/`],
      ['the right link, then a path', `${memberToken}/..%2f..%2f`],
      ['a very long value (20 kB)', 'a'.repeat(20_000)],
    ] as const) {
      const response = await feed(value);
      report.check(
        'feeds',
        `${name}: not the feed of anybody, not a server error`,
        [308, 404, 414, 431].includes(response.status) &&
          !response.body.includes('BEGIN:VCALENDAR'),
        `${response.status}`,
      );
    }

    for (const [name, value] of near) {
      const response = await feed(value);
      report.check(
        'feeds',
        `${name}: the same bare 404`,
        fingerprint(response) === reference,
        `${response.status} ${response.body.slice(0, 60)}`,
      );
      report.check(
        'feeds',
        `${name}: nothing is injected into the headers`,
        ![...response.headers.keys()].some((key) => key.toLowerCase() === 'set-cookie'),
      );
    }

    // The tokens the platform makes are long, random and different each time; a new one revokes the old one at once.
    const manifest = readManifest();
    const { id, page } = locate(manifest, 'profile.regenerateMyCalendarToken');
    const regenerated: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      await callAction(platform, 'member', id, page, []);
      regenerated.push(await tokenOf(db, persona('member').login as string));
    }
    report.check(
      'feeds',
      'a link the platform makes is 43 characters of base64url (256 bits), different each time',
      regenerated.every((token) => BASE64URL.test(token)) &&
        new Set([memberToken, ...regenerated]).size === 4,
      regenerated.map((token) => token.length).join(','),
    );
    report.check(
      'feeds',
      'after a new link, the old one is the bare 404 at once',
      fingerprint(await feed(memberToken)) === reference,
    );
    const current = regenerated[regenerated.length - 1] as string;
    report.check('feeds', 'and the new one works', (await feed(current)).status === 200);

    // Two kinds of link, two secrets: neither opens the other's door.
    const bdeToken = randomBytes(32).toString('base64url');
    report.watch('the BDE calendar link', bdeToken);
    report.watch('a regenerated calendar link', current);
    await db.query(
      `INSERT INTO "BdeCalendarFeed" ("id","token","updatedAt") VALUES ('bde',$1,now())
       ON CONFLICT ("id") DO UPDATE SET "token" = EXCLUDED."token"`,
      [bdeToken],
    );
    const bde = (token: string) => send(platform, `/api/calendar/bde/${token}`);
    report.check('feeds', 'the BDE link answers a calendar', (await bde(bdeToken)).status === 200);
    report.check(
      'feeds',
      'a member’s link does not open the BDE route',
      fingerprint(await bde(current)) === reference,
    );
    report.check(
      'feeds',
      'the BDE link does not open a member’s route',
      fingerprint(await feed(bdeToken)) === reference,
    );

    // What each feed holds. Two events a month from now: one published, one draft; a hostile one with text that
    // tries to write lines of its own.
    const category = String(
      (await db.query(`SELECT "categoryKey" FROM "Event" LIMIT 1`)).rows[0]?.categoryKey,
    );
    const author = persona('validator').login as string;
    const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const insert = async (
      id: string,
      title: string,
      status: string,
      description: string,
      location: string,
    ) =>
      db.query(
        `INSERT INTO "Event" ("id","title","description","location","categoryKey","status","startsAt","endsAt","schoolYear","authorLogin","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6::"EventStatus",$7::timestamp,$8::timestamp,'2026-2027',$9,now())`,
        [
          id,
          title,
          description,
          location,
          category,
          status,
          `${day}T18:00:00`,
          `${day}T20:00:00`,
          author,
        ],
      );
    const published = `${tag}-published`;
    const draft = `${tag}-draft`;
    const hostileTitle = `Soirée ${tag}\r\nBEGIN:VEVENT\r\nSUMMARY:injected-${tag}`;
    const hostileDescription = `line one\nATTENDEE;CN=attacker:mailto:attacker@evil.example\r\nURL:https://evil.example/${tag}\\n, ; \\`;
    const hostileLocation = `Salle ${tag}; DESCRIPTION:x\nEND:VEVENT`;
    try {
      await insert(`${tag}-p`, published, 'CONFIRMED', 'public', 'Campus');
      await insert(`${tag}-d`, draft, 'DRAFT', 'secret', 'Campus');
      await insert(`${tag}-h`, hostileTitle, 'CONFIRMED', hostileDescription, hostileLocation);

      const validatorFeed = await feed(validatorToken);
      const memberFeed = await feed(current);
      const bdeFeed = await bde(bdeToken);
      report.check(
        'feeds',
        'a validator’s link holds the published event',
        validatorFeed.body.includes(published),
      );
      report.check(
        'feeds',
        'a validator’s link holds the drafts (their job is to see them)',
        validatorFeed.body.includes(draft),
      );
      report.check(
        'feeds',
        'a member’s link holds the published event',
        memberFeed.body.includes(published),
      );
      report.check(
        'feeds',
        'a member’s link never holds a draft',
        !memberFeed.body.includes(draft),
      );
      report.check(
        'feeds',
        'the BDE link holds the published event',
        bdeFeed.body.includes(published),
      );
      report.check(
        'feeds',
        'the BDE link never holds a draft',
        !bdeFeed.body.includes(draft) && !bdeFeed.body.includes('secret'),
      );

      for (const [name, response] of [
        ['a validator’s file', validatorFeed],
        ['a member’s file', memberFeed],
        ['the BDE file', bdeFeed],
      ] as const) {
        const lines = unfold(response.body);
        const events = lines.filter((line) => line === 'BEGIN:VEVENT').length;
        const ends = lines.filter((line) => line === 'END:VEVENT').length;
        const expected = (response.body.match(new RegExp(`UID:`, 'g')) ?? []).length;
        report.check(
          'feeds',
          `${name}: text typed into an event adds no event of its own`,
          events === ends &&
            events === expected &&
            !lines.some(
              (line) =>
                line.includes(`SUMMARY:injected-${tag}`) && line.startsWith('SUMMARY:injected'),
            ),
          `${events} events, ${expected} UIDs`,
        );
        report.check(
          'feeds',
          `${name}: no line written by a member (an attendee, an address) outside the text it was typed in`,
          lines.every(
            (line) => line === '' || ALLOWED_PROPERTIES.test(line.split(/[;:]/)[0] as string),
          ),
          lines.find(
            (line) => line !== '' && !ALLOWED_PROPERTIES.test(line.split(/[;:]/)[0] as string),
          ),
        );
        report.check(
          'feeds',
          `${name}: only CRLF ends a line, none of the text’s own`,
          !/(?<!\r)\n|\r(?!\n)/.test(response.body),
        );
        report.check(
          'feeds',
          `${name}: no line longer than 75 bytes (RFC 5545 folds them)`,
          response.body.split('\r\n').every((line) => Buffer.byteLength(line) <= 75),
        );
      }
    } finally {
      await db.query(`DELETE FROM "Event" WHERE "id" LIKE $1`, [`${tag}-%`]);
      await db.query(`DELETE FROM "BdeCalendarFeed"`);
    }
  });
}
