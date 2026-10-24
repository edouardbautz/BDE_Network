// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The requests to publish on the intra (migration 20261024140000_intra_requests): a new table that touches no existing row, and the
 * rules the schema cannot express — what each state holds, the hash, the link — held by the database itself. Applies every real
 * migration, in order, to a real PostgreSQL. Runs only when MIGRATION_TEST_DATABASE_URL is set.
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const THIS = '20261024140000_intra_requests';

const created: string[] = [];
const clients: Client[] = [];

const migrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();

const apply = (client: Client, name: string) =>
  client.query(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));

async function database(applyThis: boolean): Promise<Client> {
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
  if (applyThis) await apply(client, THIS);
  return client;
}

const HASH = 'a'.repeat(64);

const insertEvent = (client: Client, id: string) =>
  client.query(
    `INSERT INTO "Event" ("id", "title", "categoryKey", "startsAt", "endsAt", "schoolYear", "authorLogin", "updatedAt")
     VALUES ($1, 'Soirée', 'soiree', '2026-11-06 18:00', '2026-11-06 21:30', '2026-2027', 'alice', CURRENT_TIMESTAMP)`,
    [id],
  );

const insertRequest = (client: Client, eventId: string, columns: string, values: string) =>
  client.query(
    `INSERT INTO "IntraRequest" ("id", "eventId", "contentHash", "requestedByLogin", "updatedAt", ${columns})
     VALUES ('r-' || $1, $1, '${HASH}', 'alice', CURRENT_TIMESTAMP, ${values})`,
    [eventId],
  );

const CONTENT = `'{"title":"x"}'::jsonb`;
const ON_INTRA = '"status", "publishedContent", "publishedAt", "answeredAt", "answeredByLogin"';

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}, 60_000);

describeWithDatabase('migration intra_requests', () => {
  it('adds a table and changes no row: every event is as it was, and has no request', async () => {
    const client = await database(false);
    await insertEvent(client, 'old-1');
    const before = (await client.query(`SELECT * FROM "Event" ORDER BY "id"`)).rows;

    await apply(client, THIS);

    expect((await client.query(`SELECT * FROM "Event" ORDER BY "id"`)).rows).toEqual(before);
    expect((await client.query(`SELECT count(*)::int AS n FROM "IntraRequest"`)).rows[0].n).toBe(0);
  });

  it('holds what each state says: a waiting request has nothing published and nobody who answered', async () => {
    const client = await database(true);
    await insertEvent(client, 'e1');
    await insertRequest(client, 'e1', '"status"', `'PENDING'`);

    await insertEvent(client, 'e2');
    await expect(
      insertRequest(
        client,
        'e2',
        '"status", "answeredAt", "answeredByLogin"',
        `'PENDING', now(), 'staff'`,
      ),
    ).rejects.toThrow(/IntraRequest_state_shape/);
    await expect(
      insertRequest(client, 'e2', '"status", "intraUrl"', `'PENDING', 'https://intra.42.fr/x'`),
    ).rejects.toThrow(/IntraRequest_state_shape/);
  });

  it('a request on the intra holds the copy, the date and who answered', async () => {
    const client = await database(true);
    for (const status of ['PUBLISHED', 'OUTDATED']) {
      await insertEvent(client, status);
      await insertRequest(
        client,
        status,
        ON_INTRA,
        `'${status}', ${CONTENT}, now(), now(), 'staff'`,
      );
    }
    await insertEvent(client, 'e1');
    // without the copy, without the date, or without the author of the answer
    for (const [columns, values] of [
      [
        '"status", "publishedAt", "answeredAt", "answeredByLogin"',
        `'PUBLISHED', now(), now(), 'staff'`,
      ],
      [
        '"status", "publishedContent", "answeredAt", "answeredByLogin"',
        `'PUBLISHED', ${CONTENT}, now(), 'staff'`,
      ],
      ['"status", "publishedContent", "publishedAt"', `'OUTDATED', ${CONTENT}, now()`],
    ] as const) {
      await expect(insertRequest(client, 'e1', columns, values)).rejects.toThrow(
        /IntraRequest_state_shape/,
      );
    }
    // and not a refusal's comment
    await expect(
      insertRequest(
        client,
        'e1',
        `${ON_INTRA}, "refusalComment"`,
        `'PUBLISHED', ${CONTENT}, now(), now(), 'staff', 'no'`,
      ),
    ).rejects.toThrow(/IntraRequest_state_shape/);
  });

  it('a refusal has its comment and its author, and publishes nothing', async () => {
    const client = await database(true);
    await insertEvent(client, 'e1');
    await insertEvent(client, 'e2');
    await insertRequest(
      client,
      'e1',
      '"status", "refusalComment", "answeredAt", "answeredByLogin"',
      `'REFUSED', 'No', now(), 'staff'`,
    );
    await expect(
      insertRequest(
        client,
        'e2',
        '"status", "answeredAt", "answeredByLogin"',
        `'REFUSED', now(), 'staff'`,
      ),
    ).rejects.toThrow(/IntraRequest_state_shape/);
    await expect(
      insertRequest(
        client,
        'e2',
        '"status", "refusalComment", "publishedContent", "publishedAt", "answeredAt", "answeredByLogin"',
        `'REFUSED', 'No', ${CONTENT}, now(), now(), 'staff'`,
      ),
    ).rejects.toThrow(/IntraRequest_state_shape/);
  });

  it('keeps a hash that is a SHA-256 and a link that is an https address of the intra', async () => {
    const client = await database(true);
    await insertEvent(client, 'e1');
    await expect(
      client.query(
        `INSERT INTO "IntraRequest" ("id", "eventId", "contentHash", "requestedByLogin", "updatedAt") VALUES ('x', 'e1', 'not-a-hash', 'alice', now())`,
      ),
    ).rejects.toThrow(/IntraRequest_hash_shape/);

    for (const [i, url] of [
      'http://intra.42.fr/x',
      'https://evil.example/intra.42.fr',
      'https://intra.42.fr.evil.example/',
      'https://user@intra.42.fr/',
      'https://intra.42.fr:8443/',
      'https://intra.42.fr/a b',
      `https://intra.42.fr/${'a'.repeat(300)}`,
    ].entries()) {
      await insertEvent(client, `u${i}`);
      await expect(
        insertRequest(
          client,
          `u${i}`,
          `${ON_INTRA}, "intraUrl"`,
          `'PUBLISHED', ${CONTENT}, now(), now(), 'staff', '${url}'`,
        ),
      ).rejects.toThrow(/IntraRequest_url_shape/);
    }
    await insertEvent(client, 'ok');
    await insertRequest(
      client,
      'ok',
      `${ON_INTRA}, "intraUrl"`,
      `'PUBLISHED', ${CONTENT}, now(), now(), 'staff', 'https://profile.intra.42.fr/events/1'`,
    );
  });

  it('is one request per event, and goes with its event', async () => {
    const client = await database(true);
    await insertEvent(client, 'e1');
    await insertRequest(client, 'e1', '"status"', `'PENDING'`);
    await expect(
      client.query(
        `INSERT INTO "IntraRequest" ("id", "eventId", "contentHash", "requestedByLogin", "updatedAt") VALUES ('second', 'e1', '${HASH}', 'alice', now())`,
      ),
    ).rejects.toThrow(/IntraRequest_eventId_key/);

    await client.query(`DELETE FROM "Event" WHERE "id" = 'e1'`);
    expect((await client.query(`SELECT count(*)::int AS n FROM "IntraRequest"`)).rows[0].n).toBe(0);
  });

  it('keeps the request when the account that sent or answered it is removed, with the login as text', async () => {
    const client = await database(true);
    await client.query(
      `INSERT INTO "User" ("id", "login", "fullName", "email", "campus", "status", "updatedAt") VALUES ('u1', 'sophie', 'Sophie', 's@example.org', 'Paris', 'OWNER', now())`,
    );
    await insertEvent(client, 'e1');
    await insertRequest(
      client,
      'e1',
      '"status", "refusalComment", "answeredAt", "answeredByLogin", "answeredById", "requestedById"',
      `'REFUSED', 'No', now(), 'sophie', 'u1', 'u1'`,
    );

    await client.query(`DELETE FROM "User" WHERE "id" = 'u1'`);

    const { rows } = await client.query(`SELECT * FROM "IntraRequest"`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      answeredById: null,
      requestedById: null,
      answeredByLogin: 'sophie',
      requestedByLogin: 'alice',
    });
  });
});
