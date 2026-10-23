// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { allOccurrences } from '@/lib/events/recurrence';

/**
 * The migration of the repeat rules turns the four shapes of a series (weekly, every two weeks, monthly, monthly on
 * a day kept in "monthlyDay") into one rule in a JSON column, without moving a date. Applies the real SQL files, in
 * order, to a real PostgreSQL: everything up to the previous migration, then events as they were stored, then the
 * migration under test. It needs a database server, so it only runs when MIGRATION_TEST_DATABASE_URL is set (CI does).
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const TARGET = '20261017100000_event_repeat_rules';

const created: string[] = [];
const clients: Client[] = [];

const migrationSql = (name: string) =>
  readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');

/** A new empty database with every migration before the one under test applied. */
async function previousDatabase(): Promise<Client> {
  const name = `migtest_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  created.push(name);

  const url = new URL(ADMIN_URL as string);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  clients.push(client);
  // The columns are `timestamp` without a zone and hold UTC. A session in any other zone must change nothing: what the test
  // writes and reads says its zone (below), and the migration is held to the same (it runs in this session).
  await client.query(`SET TIME ZONE 'Asia/Kolkata'`);

  const previous = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry) && entry < TARGET)
    .sort();
  for (const migration of previous) await client.query(migrationSql(migration));
  return client;
}

interface LegacyEvent {
  id: string;
  recurrence: 'NONE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  startsAt?: string;
  until?: string | null;
  monthlyDay?: number | null;
}

/** An event as the previous version stored it. */
const addEvent = (client: Client, event: LegacyEvent) =>
  client.query(
    `INSERT INTO "Event" ("id", "title", "categoryKey", "status", "startsAt", "endsAt", "recurrence",
       "recurrenceUntil", "monthlyDay", "schoolYear", "authorLogin", "updatedAt")
     VALUES ($1, 'Soirée', 'soiree', 'CONFIRMED', ($2::timestamptz AT TIME ZONE 'UTC'),
       ($2::timestamptz + interval '2 hours') AT TIME ZONE 'UTC',
       $3::"EventRecurrence", ($4::timestamptz AT TIME ZONE 'UTC'), $5, '2026-2027', 'alice', now())`,
    [
      event.id,
      event.startsAt ?? '2027-01-31T17:00:00Z',
      event.recurrence,
      event.until === undefined ? null : event.until,
      event.monthlyDay ?? null,
    ],
  );

interface Stored {
  id: string;
  repeat: unknown;
  startsAt: Date;
  endsAt: Date;
  recurrenceUntil: Date | null;
}

const stored = async (client: Client): Promise<Map<string, Stored>> => {
  const { rows } = await client.query<Stored>(
    // `AT TIME ZONE 'UTC'` turns the column into the instant it holds: `pg` reads a `timestamp` in the zone of the machine, which
    // moved every date by the offset of that zone (an hour in Paris in winter, the test passing only on a machine in UTC)
    `SELECT "id", "repeat", ("startsAt" AT TIME ZONE 'UTC') AS "startsAt", ("endsAt" AT TIME ZONE 'UTC') AS "endsAt",
       ("recurrenceUntil" AT TIME ZONE 'UTC') AS "recurrenceUntil" FROM "Event" ORDER BY "id"`,
  );
  return new Map(rows.map((row) => [row.id, row]));
};

// One database per test, dropped one after the other: this can take longer than the 10 s of a hook on a loaded runner.
afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  if (!ADMIN_URL || created.length === 0) return;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}, 60_000);

describeWithDatabase('event repeat rules migration', () => {
  it('turns each of the four shapes into the rule that gives its dates', async () => {
    const client = await previousDatabase();
    const until = '2027-06-30T22:00:00Z';
    await addEvent(client, { id: 'weekly', recurrence: 'WEEKLY', until });
    await addEvent(client, { id: 'biweekly', recurrence: 'BIWEEKLY', until });
    await addEvent(client, { id: 'monthly', recurrence: 'MONTHLY', until });
    await addEvent(client, { id: 'monthly31', recurrence: 'MONTHLY', until, monthlyDay: 31 });
    await client.query(migrationSql(TARGET));

    const events = await stored(client);
    expect(events.get('weekly')?.repeat).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(events.get('biweekly')?.repeat).toEqual({ freq: 'WEEKLY', interval: 2 });
    expect(events.get('monthly')?.repeat).toEqual({ freq: 'MONTHLY', interval: 1 });
    expect(events.get('monthly31')?.repeat).toEqual({
      freq: 'MONTHLY',
      interval: 1,
      monthly: { kind: 'day', day: 31 },
    });
  });

  it('does not move a date: the rules give the dates the old shapes gave', async () => {
    const client = await previousDatabase();
    const until = '2027-06-30T22:00:00Z';
    await addEvent(client, { id: 'weekly', recurrence: 'WEEKLY', until });
    await addEvent(client, { id: 'biweekly', recurrence: 'BIWEEKLY', until });
    await addEvent(client, { id: 'monthly', recurrence: 'MONTHLY', until });
    await addEvent(client, { id: 'monthly31', recurrence: 'MONTHLY', until, monthlyDay: 31 });
    // a series cut on a short month used to keep its day in monthlyDay: it starts on the 28th
    await addEvent(client, {
      id: 'monthly31-cut',
      recurrence: 'MONTHLY',
      startsAt: '2027-02-28T17:00:00Z',
      until,
      monthlyDay: 31,
    });
    await client.query(migrationSql(TARGET));

    const starts = (event: Stored) =>
      allOccurrences(event, 'Europe/Paris').map((occurrence) => occurrence.start.toISOString());
    const events = await stored(client);

    expect(starts(events.get('weekly') as Stored)).toHaveLength(22);
    expect(starts(events.get('weekly') as Stored).slice(0, 2)).toEqual([
      '2027-01-31T17:00:00.000Z',
      '2027-02-07T17:00:00.000Z',
    ]);
    expect(starts(events.get('biweekly') as Stored).slice(0, 2)).toEqual([
      '2027-01-31T17:00:00.000Z',
      '2027-02-14T17:00:00.000Z',
    ]);
    expect(starts(events.get('monthly') as Stored)).toEqual([
      '2027-01-31T17:00:00.000Z',
      '2027-02-28T17:00:00.000Z',
      '2027-03-31T16:00:00.000Z',
      '2027-04-30T16:00:00.000Z',
      '2027-05-31T16:00:00.000Z',
      '2027-06-30T16:00:00.000Z',
    ]);
    // the 31st, kept through the short month the series was cut on
    expect(starts(events.get('monthly31-cut') as Stored)).toEqual([
      '2027-02-28T17:00:00.000Z',
      '2027-03-31T16:00:00.000Z',
      '2027-04-30T16:00:00.000Z',
      '2027-05-31T16:00:00.000Z',
      '2027-06-30T16:00:00.000Z',
    ]);
  });

  it('leaves an event that does not repeat without a rule, and drops an end date it never used', async () => {
    const client = await previousDatabase();
    await addEvent(client, { id: 'one', recurrence: 'NONE' });
    await addEvent(client, {
      id: 'one-with-end',
      recurrence: 'NONE',
      until: '2027-03-01T00:00:00Z',
    });
    await client.query(migrationSql(TARGET));

    const events = await stored(client);
    for (const id of ['one', 'one-with-end']) {
      expect(events.get(id)).toMatchObject({ repeat: null, recurrenceUntil: null });
    }
  });

  it('keeps a series with no end date as the single date it was for the application', async () => {
    const client = await previousDatabase();
    await addEvent(client, { id: 'open', recurrence: 'WEEKLY', until: null });
    await client.query(migrationSql(TARGET));

    expect(await stored(client)).toSatisfy((events: Map<string, Stored>) => {
      const event = events.get('open');
      return event?.repeat === null && event.recurrenceUntil === null;
    });
  });

  it('keeps the dates, the end and everything else of every event as it was', async () => {
    const client = await previousDatabase();
    await addEvent(client, { id: 'weekly', recurrence: 'WEEKLY', until: '2027-06-30T22:00:00Z' });
    const { rows } = await client.query<Omit<Stored, 'repeat'>>(
      `SELECT "id", ("startsAt" AT TIME ZONE 'UTC') AS "startsAt", ("endsAt" AT TIME ZONE 'UTC') AS "endsAt",
         ("recurrenceUntil" AT TIME ZONE 'UTC') AS "recurrenceUntil" FROM "Event"`,
    );
    const before = rows[0];
    await client.query(migrationSql(TARGET));
    const after = await stored(client);

    expect(after.get('weekly')).toMatchObject({
      startsAt: before?.startsAt,
      endsAt: before?.endsAt,
      recurrenceUntil: before?.recurrenceUntil,
    });
  });

  it('drops the old columns and the type', async () => {
    const client = await previousDatabase();
    await client.query(migrationSql(TARGET));

    const columns = await client.query<{ column_name: string }>(
      `SELECT "column_name" FROM information_schema.columns
       WHERE "table_name" = 'Event' AND "column_name" IN ('recurrence', 'monthlyDay', 'repeat')`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(['repeat']);
    const types = await client.query(`SELECT 1 FROM pg_type WHERE "typname" = 'EventRecurrence'`);
    expect(types.rows).toEqual([]);
  });

  it('refuses a series with no end, and an end with no series (the database says it too)', async () => {
    const client = await previousDatabase();
    await addEvent(client, { id: 'one', recurrence: 'NONE' });
    await addEvent(client, { id: 'series', recurrence: 'WEEKLY', until: '2027-06-30T22:00:00Z' });
    await client.query(migrationSql(TARGET));

    await expect(
      client.query(`UPDATE "Event" SET "recurrenceUntil" = now() WHERE "id" = 'one'`),
    ).rejects.toThrow(/Event_repeat_has_an_end/);
    await expect(
      client.query(`UPDATE "Event" SET "recurrenceUntil" = NULL WHERE "id" = 'series'`),
    ).rejects.toThrow(/Event_repeat_has_an_end/);
  });
});
