import { randomBytes } from 'node:crypto';
import type { Platform } from '../access/http';
import { changedTables, snapshot, withDatabase } from '../access/http';
import { eventForm } from '../access/actions';
import { callAction, locate, readManifest } from '../access/actions-run';
import { isNotFoundPage, Report, send } from './core';

/**
 * SQL injection through the one form that writes the most: the event form (the server action `createEvent`). It is the case ZAP's active
 * scan reports (rule 40018, "the page results were successfully manipulated using the boolean conditions"): the same field sent with a
 * condition that is true and with one that is false. The scan gives no evidence, and the platform builds no SQL from a string anywhere
 * in `src/` (Prisma binds every value; a Semgrep rule forbids the rest), but "the code does not do it" is not the same as "the
 * platform does not do it": this plays the pairs against the real image and reads what the database holds.
 *
 * Every field of the form gets the pairs and a few hostile statements. A text (title, description, place) must be **stored as
 * typed**, byte for byte, and nothing but the event and its audit entry may change (a `DROP TABLE`, an `UPDATE "User"` or a `UNION` that did anything would
 * show in another table). A field with a fixed set of values (category, status, repetition, dates, people in charge) may be refused
 * or accepted, as the form decides, but **never changes anything beyond the event**. And for every pair, whether the condition is true
 * or false makes **no difference to the outcome** (the status of the answer, the tables that changed): that difference is the whole of what the scan saw.
 */

const tag = `sql${randomBytes(3).toString('hex')}`;

/** What the scan sends: a true condition and a false one, in each way a value can be closed. */
const PAIRS: [string, string][] = [
  [`x' AND '1'='1' -- `, `x' AND '1'='2' -- `],
  [`x" AND "1"="1" -- `, `x" AND "1"="2" -- `],
  [`x AND 1=1 -- `, `x AND 1=2 -- `],
  [`x' OR '1'='1`, `x' OR '1'='2`],
];

const HOSTILE = [
  `'; DROP TABLE "Event"; --`,
  `1; UPDATE "User" SET status='OWNER'; --`,
  `' UNION SELECT login, "calendarToken" FROM "User" --`,
];

const TEXTS = ['title', 'description', 'location'] as const;
const CHOICES = [
  'categoryKey',
  'status',
  'repeat',
  'startsAt',
  'endsAt',
  'assignees',
  'repeatFreq',
] as const;

/** What an event written by the form may change: the event, and what is written about it. */
const WRITTEN_BY_AN_EVENT = ['AuditLog', 'Event', 'EventAssignee'];

export async function checkSql(platform: Platform, report: Report): Promise<void> {
  const create = locate(readManifest(), 'events.createEvent');

  // The events module is off on one variant of the platform (`--variant events-disabled`): there is no form, and the action of it must write nothing.
  if (isNotFoundPage(await send(platform, '/fr/events', { as: 'owner' }))) {
    await withDatabase(platform, async (db) => {
      const before = await snapshot(db);
      await callAction(platform, 'validator', create.id, create.page, [
        {},
        eventForm({ title: `${HOSTILE[0]}${tag}` }),
      ]);
      const changed = changedTables(before, await snapshot(db));
      report.check(
        'sql',
        'while the events module is off, the action of the form refuses and writes nothing',
        changed.length === 0,
        changed.join('+') || 'nothing written',
      );
    });
    return;
  }

  await withDatabase(platform, async (db) => {
    let counter = 0;
    /** One call of the form with `value` in `field`; what the answer was, and what the database did. */
    const play = async (field: string, value: string) => {
      counter += 1;
      const title = field === 'title' ? value : `${tag}-${field}-${counter}`;
      const before = await snapshot(db);
      const call = await callAction(platform, 'validator', create.id, create.page, [
        {},
        eventForm({ ...(field === 'title' ? {} : { title }), [field]: value }),
      ]);
      const changed = changedTables(before, await snapshot(db));
      const row = (
        await db.query(
          `SELECT "title","description","location" FROM "Event" WHERE "title" = $1 OR "title" LIKE $2`,
          [title, `${tag}-${field}-${counter}%`],
        )
      ).rows[0] as Record<string, string> | undefined;
      return { call, changed, row };
    };
    const outcome = (result: Awaited<ReturnType<typeof play>>) =>
      `${result.call.status} ${result.changed.join('+') || 'nothing written'}`;

    try {
      // --- a text is stored as it was typed, and nothing else is touched ---------------------------------------------
      for (const field of TEXTS) {
        for (const value of [...PAIRS.flat(), ...HOSTILE].map((text) => `${text}${tag}`)) {
          const result = await play(field, value);
          report.check(
            'sql',
            `the form, ${field}: ${value.slice(0, 40)}… is stored as typed and writes only the event`,
            !result.call.threw &&
              result.row?.[field] === value &&
              result.changed.every((table) => WRITTEN_BY_AN_EVENT.includes(table)),
            `${outcome(result)}; stored ${JSON.stringify(result.row?.[field] ?? null)?.slice(0, 60)}`,
          );
        }
        for (const [yes, no] of PAIRS) {
          const a = await play(field, `${yes}${tag}`);
          const b = await play(field, `${no}${tag}`);
          report.check(
            'sql',
            `the form, ${field}: "${yes.slice(0, 22)}" and "${no.slice(0, 22)}" give the same outcome`,
            outcome(a) === outcome(b),
            `${outcome(a)} / ${outcome(b)}`,
          );
        }
      }

      // --- a field with a fixed set of values: refused or accepted as the form decides, never anything more ---------------
      for (const field of CHOICES) {
        for (const [yes, no] of PAIRS) {
          const a = await play(field, yes);
          const b = await play(field, no);
          report.check(
            'sql',
            `the form, ${field}: "${yes.slice(0, 22)}" and "${no.slice(0, 22)}" give the same outcome and write nothing beyond the event`,
            outcome(a) === outcome(b) &&
              [a, b].every((result) =>
                result.changed.every((table) => WRITTEN_BY_AN_EVENT.includes(table)),
              ),
            `${outcome(a)} / ${outcome(b)}`,
          );
        }
        for (const value of HOSTILE) {
          const result = await play(field, value);
          report.check(
            'sql',
            `the form, ${field}: ${value.slice(0, 40)}… writes nothing beyond the event`,
            result.changed.every((table) => WRITTEN_BY_AN_EVENT.includes(table)),
            outcome(result),
          );
        }
      }

      // The statements above were meant to do harm: the platform still holds what it held.
      const { rows } = await db.query(`SELECT count(*)::int AS members FROM "User"`);
      report.check(
        'sql',
        'after all of them the accounts are all there, and the owner is still the only one',
        Number(rows[0]?.members) > 0 &&
          Number(
            (await db.query(`SELECT count(*)::int AS n FROM "User" WHERE "status" = 'OWNER'`))
              .rows[0]?.n,
          ) === 1,
        `${rows[0]?.members} accounts`,
      );
    } finally {
      await db.query(`DELETE FROM "Event" WHERE "title" LIKE $1`, [`%${tag}%`]);
    }
  });
}
