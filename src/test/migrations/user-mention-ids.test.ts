// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The ids of Discord and Slack a person gives to be mentioned (migration 20261024120000_user_mention_ids): nobody has one
 * until they say so, nothing existing changes, and the database refuses anything but the shape of a real id, because the value ends
 * up in a message that pings. Applies every real migration, in order, to a real PostgreSQL. Runs only when
 * MIGRATION_TEST_DATABASE_URL is set.
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const THIS = '20261024120000_user_mention_ids';

const created: string[] = [];
const clients: Client[] = [];

const migrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();
const apply = (client: Client, name: string) =>
  client.query(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));

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

const insertMember = (
  client: Client,
  login: string,
  discord: string | null,
  slack: string | null,
) =>
  client.query(
    `INSERT INTO "User" ("id", "login", "fullName", "email", "campus", "status", "roleId", "updatedAt", "discordUserId", "slackUserId")
     VALUES ($1, $1, $1, 'a@example.org', 'Paris', 'MEMBER', 'role-member', CURRENT_TIMESTAMP, $2, $3)`,
    [login, discord, slack],
  );

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}, 60_000);

describeWithDatabase('migration user_mention_ids', () => {
  it('keeps every account as it was, with no id', async () => {
    const client = await databaseBefore();
    await client.query(
      `INSERT INTO "User" ("id", "login", "fullName", "email", "campus", "status", "roleId", "updatedAt")
       VALUES ('old', 'old', 'Old', 'o@example.org', 'Paris', 'MEMBER', 'role-member', CURRENT_TIMESTAMP)`,
    );
    const before = (await client.query(`SELECT * FROM "User" WHERE "id" = 'old'`)).rows[0];

    await apply(client, THIS);

    const after = (await client.query(`SELECT * FROM "User" WHERE "id" = 'old'`)).rows[0];
    for (const column of Object.keys(before)) expect(after[column]).toEqual(before[column]);
    expect(after.discordUserId).toBeNull();
    expect(after.slackUserId).toBeNull();
  });

  it.each([
    ['both', '348291047563210241', 'U04ABCD1234'],
    ['none', null, null],
    ['the shortest and the longest', '12345678901234567', 'W0ABCDEFG'],
    ['the longest Discord id', '12345678901234567890', 'UABCDEFGHIJKL'],
  ])('accepts %s', async (_what, discord, slack) => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(insertMember(client, 'a', discord, slack)).resolves.toBeDefined();
  });

  it.each([
    ['a name', 'paula'],
    ['a mention that pings everybody', '@everyone'],
    ['a mention', '<@348291047563210241>'],
    ['too short', '1234567890123456'],
    ['too long', '123456789012345678901'],
    ['digits and a letter', '34829104756321024a'],
    ['an id and a line more', '348291047563210241\n@everyone'],
  ])('refuses a Discord id that is %s', async (_what, discord) => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(insertMember(client, 'a', discord, null)).rejects.toThrow(
      /User_discord_user_id_shape/,
    );
  });

  it.each([
    ['a name', 'paula'],
    ['lower case', 'u04abcd1234'],
    ['a channel id', 'C04ABCD1234'],
    ['too short', 'U0ABCDEF'],
    ['too long', 'UABCDEFGHIJKLM'],
    ['a broadcast', '<!channel>'],
  ])('refuses a Slack id that is %s', async (_what, slack) => {
    const client = await databaseBefore();
    await apply(client, THIS);
    await expect(insertMember(client, 'a', null, slack)).rejects.toThrow(
      /User_slack_user_id_shape/,
    );
  });
});
