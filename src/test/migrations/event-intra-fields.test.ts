// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The fields of the intra's form (migration 20261024100000_event_intra_fields): events written before them keep every value
 * and simply have none, and the database holds the two rules the schema cannot express (all of them or none, sane numbers).
 * Applies every real migration, in order, to a real PostgreSQL. Runs only when MIGRATION_TEST_DATABASE_URL is set.
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const THIS = '20261024100000_event_intra_fields';

const created: string[] = [];
const clients: Client[] = [];

const migrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();

const apply = (client: Client, name: string) =>
  client.query(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));

/** A database with every migration before this one applied: the platform as it was. */
async function databaseBefore(): Promise<Client> {
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
  for (const migration of migrations().filter((entry) => entry < THIS))
    await apply(client, migration);
  return client;
}

/** An event with the given intra columns (`$2` in `values` is the login given as the one parameter). */
const insertEvent = (
  client: Client,
  id: string,
  intra?: { columns: string; values: string },
  login?: string,
) =>
  client.query(
    `INSERT INTO "Event" ("id", "title", "categoryKey", "startsAt", "endsAt", "schoolYear", "authorLogin", "updatedAt"${intra ? `, ${intra.columns}` : ''})
     VALUES ($1, 'Soirée', 'soiree', '2026-11-06 18:00', '2026-11-06 21:30', '2026-2027', 'alice', CURRENT_TIMESTAMP${intra ? `, ${intra.values}` : ''})`,
    login === undefined || !intra?.values.includes('$2') ? [id] : [id, login],
  );

const COLUMNS =
  '"intraOrganizerLogin", "intraAudience", "intraMaxPeople", "intraWaitingList", "intraKind", "intraUnsubscribeHours", "intraKeywords"';
const complete = (values = "$2, 'BOTH', 60, true, 'Meet/meet_up', 24, ARRAY['bde']") => ({
  columns: COLUMNS,
  values,
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}, 60_000);

describeWithDatabase('migration event_intra_fields', () => {
  it('keeps every event as it was, with no intra field, and loses nothing', async () => {
    const client = await databaseBefore();
    await insertEvent(client, 'old-1');
    await insertEvent(client, 'old-2');
    const before = await client.query(`SELECT * FROM "Event" ORDER BY "id"`);

    await apply(client, THIS);

    const after = await client.query(`SELECT * FROM "Event" ORDER BY "id"`);
    expect(after.rows).toHaveLength(2);
    for (const [index, row] of after.rows.entries()) {
      const was = before.rows[index];
      for (const column of Object.keys(was)) expect(row[column]).toEqual(was[column]);
      expect(row.intraOrganizerLogin).toBeNull();
      expect(row.intraAudience).toBeNull();
      expect(row.intraKeywords).toEqual([]);
    }
  });

  it('accepts a complete set, and an event with none', async () => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(insertEvent(client, 'plain')).resolves.toBeDefined();
    await expect(insertEvent(client, 'full', complete(), 'demo-president')).resolves.toBeDefined();
  });

  it.each([
    ['an organizer and nothing else', { columns: '"intraOrganizerLogin"', values: '$2' }],
    ['a kind and nothing else', { columns: '"intraKind"', values: "'Association'" }],
    [
      'everything but the keywords',
      {
        columns: COLUMNS.replace(', "intraKeywords"', ''),
        values: "$2, 'BOTH', 60, true, 'Meet/meet_up', 24",
      },
    ],
    ['keywords and nothing else', { columns: '"intraKeywords"', values: "ARRAY['bde']" }],
  ])('refuses %s', async (_label, intra) => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(insertEvent(client, 'half', intra, 'alice')).rejects.toThrow(
      /Event_intra_complete/,
    );
  });

  it('refuses a room for nobody and a negative delay', async () => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(
      insertEvent(
        client,
        'a',
        complete("$2, 'BOTH', 0, true, 'Meet/meet_up', 24, ARRAY['bde']"),
        'alice',
      ),
    ).rejects.toThrow(/Event_intra_bounds/);
    await expect(
      insertEvent(
        client,
        'b',
        complete("$2, 'BOTH', 60, true, 'Meet/meet_up', -1, ARRAY['bde']"),
        'alice',
      ),
    ).rejects.toThrow(/Event_intra_bounds/);
  });

  it('refuses an audience that is not one of the three', async () => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(
      insertEvent(
        client,
        'c',
        complete("$2, 'EVERYONE', 60, true, 'Meet/meet_up', 24, ARRAY['bde']"),
        'alice',
      ),
    ).rejects.toThrow(/IntraAudience/);
  });
});
