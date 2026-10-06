// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Two accounts may share an e-mail address (the login identifies a person). Applies every real
 * migration, in order, to a real PostgreSQL. Runs only when MIGRATION_TEST_DATABASE_URL is set.
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

const created: string[] = [];
const clients: Client[] = [];

async function migratedDatabase(): Promise<Client> {
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

  for (const migration of readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort()) {
    await client.query(readFileSync(join(MIGRATIONS_DIR, migration, 'migration.sql'), 'utf8'));
  }
  return client;
}

const insertMember = (client: Client, login: string, email: string) =>
  client.query(
    `INSERT INTO "User" ("id", "login", "fullName", "email", "campus", "status", "roleId", "updatedAt")
     VALUES ($1, $1, $1, $2, 'Paris', 'MEMBER', 'role-member', CURRENT_TIMESTAMP)`,
    [login, email],
  );

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
});

describeWithDatabase('migration user_email_not_unique', () => {
  it('lets two accounts have the same e-mail address', async () => {
    const client = await migratedDatabase();
    await insertMember(client, 'alice', 'shared@example.org');

    await expect(insertMember(client, 'bob', 'shared@example.org')).resolves.toBeDefined();
  });

  it('still refuses two accounts with the same login (that is the identity)', async () => {
    const client = await migratedDatabase();
    await insertMember(client, 'alice', 'a@example.org');

    await expect(insertMember(client, 'alice', 'b@example.org')).rejects.toThrow(
      /unique|duplicate/i,
    );
  });
});
