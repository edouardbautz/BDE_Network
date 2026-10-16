// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The migration of the proposal circuit replaces the "events.manage" right by "events.propose" and
 * "events.validate", and gives events a PROPOSED status. Applies the real SQL files, in order, to a real PostgreSQL:
 * everything up to the previous migration, then roles as they were, then the migration under test. It needs a
 * database server, so it only runs when MIGRATION_TEST_DATABASE_URL is set (CI does).
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const TARGET = '20261016120000_event_proposals';

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

  const previous = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry) && entry < TARGET)
    .sort();
  for (const migration of previous) await client.query(migrationSql(migration));
  return client;
}

const addRole = (client: Client, id: string, permissions: string[], allPermissions = false) =>
  client.query(
    `INSERT INTO "Role" ("id", "name", "permissions", "allPermissions", "isDefault", "updatedAt")
     VALUES ($1, $1, $2, $3, false, CURRENT_TIMESTAMP)`,
    [id, permissions, allPermissions],
  );

const permissionsOf = async (client: Client, id: string) =>
  (
    await client.query<{ permissions: string[] }>(
      `SELECT "permissions" FROM "Role" WHERE "id" = $1`,
      [id],
    )
  ).rows[0]?.permissions;

const addEvent = (client: Client, id: string, status: string) =>
  client.query(
    `INSERT INTO "Event" ("id", "title", "categoryKey", "status", "startsAt", "endsAt", "schoolYear", "authorLogin", "updatedAt")
     VALUES ($1, 'Soirée', 'soiree', $2::"EventStatus", now(), now() + interval '2 hours', '2026-2027', 'alice', now())`,
    [id, status],
  );

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  if (!ADMIN_URL || created.length === 0) return;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describeWithDatabase('event proposals migration', () => {
  it('turns "events.manage" into "events.validate", with what it includes, sorted', async () => {
    const client = await previousDatabase();
    await addRole(client, 'secretary', ['members.manage', 'events.view', 'events.manage']);
    await addRole(client, 'lead', ['events.manage', 'events.shared_calendar']);
    await client.query(migrationSql(TARGET));

    expect(await permissionsOf(client, 'secretary')).toEqual([
      'events.propose',
      'events.validate',
      'events.view',
      'members.manage',
    ]);
    expect(await permissionsOf(client, 'lead')).toEqual([
      'events.propose',
      'events.shared_calendar',
      'events.validate',
      'events.view',
    ]);
  });

  it('leaves every other role as it was, and keeps the default roles', async () => {
    const client = await previousDatabase();
    await addRole(client, 'viewer', ['events.view']);
    await addRole(client, 'finance', ['finance.manage', 'finance.view']);
    await addRole(client, 'everything', [], true);
    await client.query(migrationSql(TARGET));

    expect(await permissionsOf(client, 'viewer')).toEqual(['events.view']);
    expect(await permissionsOf(client, 'finance')).toEqual(['finance.manage', 'finance.view']);
    expect(await permissionsOf(client, 'everything')).toEqual([]);
    expect(await permissionsOf(client, 'role-member')).toEqual(['events.view']);
    const { rows } = await client.query(
      `SELECT "allPermissions" FROM "Role" WHERE "id" IN ('role-admin', 'everything') ORDER BY "id"`,
    );
    expect(rows).toEqual([{ allPermissions: true }, { allPermissions: true }]);
  });

  it('records the roles it converted, as they were, in one audit entry', async () => {
    const client = await previousDatabase();
    await addRole(client, 'secretary', ['members.manage', 'events.view', 'events.manage']);
    await addRole(client, 'viewer', ['events.view']);
    await client.query(migrationSql(TARGET));

    const { rows } = await client.query<{
      actorLogin: string;
      action: string;
      metadata: { roles: { id: string; name: string; previousPermissions: string[] }[] };
    }>(`SELECT "actorLogin", "action", "metadata" FROM "AuditLog" WHERE "action" = 'role.migrate'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorLogin: 'system', action: 'role.migrate' });
    expect(rows[0]?.metadata.roles).toEqual([
      {
        id: 'secretary',
        name: 'secretary',
        previousPermissions: ['members.manage', 'events.view', 'events.manage'],
      },
    ]);
  });

  it('logs nothing when no role could manage events', async () => {
    const client = await previousDatabase();
    await addRole(client, 'viewer', ['events.view']);
    await client.query(migrationSql(TARGET));

    const { rows } = await client.query(`SELECT 1 FROM "AuditLog" WHERE "action" = 'role.migrate'`);
    expect(rows).toEqual([]);
  });

  it('leaves the events as they were and lets one be proposed', async () => {
    const client = await previousDatabase();
    await addEvent(client, 'draft', 'DRAFT');
    await addEvent(client, 'published', 'CONFIRMED');
    await client.query(migrationSql(TARGET));
    await addEvent(client, 'proposed', 'PROPOSED');

    const { rows } = await client.query(
      `SELECT "id", "status"::text AS "status", "proposedAt", "refusalComment" FROM "Event" ORDER BY "id"`,
    );
    expect(rows).toEqual([
      { id: 'draft', status: 'DRAFT', proposedAt: null, refusalComment: null },
      { id: 'proposed', status: 'PROPOSED', proposedAt: null, refusalComment: null },
      { id: 'published', status: 'CONFIRMED', proposedAt: null, refusalComment: null },
    ]);
  });

  it('refuses a refusal that is not a comment, its author and its date together', async () => {
    const client = await previousDatabase();
    await addEvent(client, 'evt', 'DRAFT');
    await client.query(migrationSql(TARGET));

    const refuse = (set: string) => client.query(`UPDATE "Event" SET ${set} WHERE "id" = 'evt'`);
    await expect(refuse(`"refusalComment" = 'Non'`)).rejects.toThrow(/Event_refusal_complete/);
    await expect(refuse(`"refusedByLogin" = 'bob', "refusedAt" = now()`)).rejects.toThrow(
      /Event_refusal_complete/,
    );
    await expect(
      refuse(`"refusalComment" = 'Non', "refusedByLogin" = 'bob', "refusedAt" = now()`),
    ).resolves.toBeDefined();
    await expect(
      refuse(`"refusalComment" = NULL, "refusedByLogin" = NULL, "refusedAt" = NULL`),
    ).resolves.toBeDefined();
  });
});
