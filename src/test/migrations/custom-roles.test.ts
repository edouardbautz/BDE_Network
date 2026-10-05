// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The custom-roles migration turns the ADMIN / MEMBER enum and the per-user
 * ModulePermission table into roles. This applies the real SQL files, in order,
 * to a real PostgreSQL: first everything up to the previous migration, then
 * legacy accounts, then the migration under test.
 *
 * It needs a database server, so it only runs when MIGRATION_TEST_DATABASE_URL
 * is set (CI does; locally: a throwaway postgres container).
 */

const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const describeWithDatabase = ADMIN_URL ? describe : describe.skip;

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const TARGET = '20261005180000_custom_roles';

const created: string[] = [];
const clients: Client[] = [];

function migrationSql(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
}

/** A new empty database with every migration before the one under test applied. */
async function legacyDatabase(): Promise<Client> {
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
  for (const migration of previous) {
    await client.query(migrationSql(migration));
  }
  return client;
}

async function addLegacyUser(
  client: Client,
  login: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'PENDING',
  grants: { module: string; grantedBy: string }[] = [],
) {
  await client.query(
    `INSERT INTO "User" ("id", "login", "fullName", "email", "campus", "role", "updatedAt")
     VALUES ($1, $1, $1, $1 || '@example.org', 'Paris', $2::"Role", CURRENT_TIMESTAMP)`,
    [login, role],
  );
  for (const grant of grants) {
    await client.query(
      `INSERT INTO "ModulePermission" ("id", "userId", "module", "grantedByLogin")
       VALUES ($1, $2, $3, $4)`,
      [`${login}-${grant.module}`, login, grant.module, grant.grantedBy],
    );
  }
}

/** The legacy accounts used by most tests. */
async function seedLegacyAccounts(client: Client) {
  await addLegacyUser(client, 'owner1', 'OWNER');
  await addLegacyUser(client, 'pending1', 'PENDING', [{ module: 'events', grantedBy: 'owner1' }]);
  await addLegacyUser(client, 'admin1', 'ADMIN');
  await addLegacyUser(client, 'admin2', 'ADMIN', [{ module: 'events', grantedBy: 'owner1' }]);
  await addLegacyUser(client, 'member1', 'MEMBER');
  await addLegacyUser(client, 'member2', 'MEMBER', [{ module: 'events', grantedBy: 'admin1' }]);
  await addLegacyUser(client, 'member3', 'MEMBER', [{ module: 'events', grantedBy: 'owner1' }]);
  await addLegacyUser(client, 'member4', 'MEMBER', [
    { module: 'finance', grantedBy: 'admin1' },
    { module: 'events', grantedBy: 'admin1' },
  ]);
  await addLegacyUser(client, 'member5', 'MEMBER', [{ module: 'finance', grantedBy: 'admin1' }]);
}

interface RoleRow {
  id: string;
  name: string;
  permissions: string[];
  allPermissions: boolean;
  isDefault: boolean;
}

const roles = async (client: Client): Promise<RoleRow[]> =>
  (
    await client.query<RoleRow>(
      `SELECT "id", "name", "permissions", "allPermissions", "isDefault" FROM "Role" ORDER BY "id"`,
    )
  ).rows;

async function accounts(client: Client) {
  const { rows } = await client.query<{ login: string; status: string; roleId: string | null }>(
    `SELECT "login", "status"::text AS "status", "roleId" FROM "User" ORDER BY "login"`,
  );
  return Object.fromEntries(rows.map((row) => [row.login, row]));
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  if (!ADMIN_URL || created.length === 0) return;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const name of created) {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
  await admin.end();
});

describeWithDatabase('custom roles migration', () => {
  it('creates the two default roles on a fresh install, and logs nothing', async () => {
    const client = await legacyDatabase();
    await client.query(migrationSql(TARGET));

    expect(await roles(client)).toEqual([
      {
        id: 'role-admin',
        name: 'Admin',
        permissions: [],
        allPermissions: true,
        isDefault: false,
      },
      {
        id: 'role-member',
        name: 'Membre',
        permissions: ['events.view'],
        allPermissions: false,
        isDefault: true,
      },
    ]);
    const { rows } = await client.query(`SELECT 1 FROM "AuditLog" WHERE "action" = 'role.migrate'`);
    expect(rows).toHaveLength(0);
  });

  it('maps every legacy account to a status and a role', async () => {
    const client = await legacyDatabase();
    await seedLegacyAccounts(client);
    await client.query(migrationSql(TARGET));

    const byLogin = await accounts(client);
    const statusAndRole = (login: string) => [byLogin[login]?.status, byLogin[login]?.roleId];

    expect(statusAndRole('owner1')).toEqual(['OWNER', null]);
    expect(statusAndRole('pending1')).toEqual(['PENDING', null]);
    expect(statusAndRole('admin1')).toEqual(['MEMBER', 'role-admin']);
    // An ADMIN who also had module grants is simply Admin: that role already covers them.
    expect(statusAndRole('admin2')).toEqual(['MEMBER', 'role-admin']);
    expect(statusAndRole('member1')).toEqual(['MEMBER', 'role-member']);
  });

  it('keeps per-user module grants as generated roles, one per distinct set of modules', async () => {
    const client = await legacyDatabase();
    await seedLegacyAccounts(client);
    await client.query(migrationSql(TARGET));

    const byLogin = await accounts(client);
    const all = await roles(client);
    const generated = all.filter((role) => role.id.startsWith('role-migrated-'));

    // member2 and member3 had the same modules: they share one role.
    expect(byLogin.member2?.roleId).toBe(byLogin.member3?.roleId);
    expect(
      new Set([byLogin.member2?.roleId, byLogin.member4?.roleId, byLogin.member5?.roleId]).size,
    ).toBe(3);

    expect(
      generated.map(({ name, permissions, allPermissions, isDefault }) => ({
        name,
        permissions,
        allPermissions,
        isDefault,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          name: 'Membre + Événements',
          permissions: ['events.manage', 'events.view'],
          allPermissions: false,
          isDefault: false,
        },
        {
          name: 'Membre + Événements + Finance',
          permissions: ['events.manage', 'events.view', 'finance.manage', 'finance.view'],
          allPermissions: false,
          isDefault: false,
        },
        {
          // Not granted events, but every "Membre" can still see them.
          name: 'Membre + Finance',
          permissions: ['events.view', 'finance.manage', 'finance.view'],
          allPermissions: false,
          isDefault: false,
        },
      ]),
    );
    expect(generated).toHaveLength(3);

    const memberRole = all.find((role) => role.id === byLogin.member4?.roleId);
    expect(memberRole?.name).toBe('Membre + Événements + Finance');
  });

  it('records the previous situation of every account in one audit entry', async () => {
    const client = await legacyDatabase();
    await seedLegacyAccounts(client);
    await client.query(migrationSql(TARGET));

    const { rows } = await client.query<{
      actorLogin: string;
      targetType: string;
      metadata: {
        accounts: {
          login: string;
          previousRole: string;
          newRole: string | null;
          moduleGrants: { module: string; grantedByLogin: string; grantedAt: string }[];
        }[];
      };
    }>(
      `SELECT "actorLogin", "targetType", "metadata" FROM "AuditLog" WHERE "action" = 'role.migrate'`,
    );

    expect(rows).toHaveLength(1);
    const entry = rows[0];
    expect(entry?.actorLogin).toBe('system');

    const recorded = Object.fromEntries((entry?.metadata.accounts ?? []).map((a) => [a.login, a]));
    // Every approved account, plus the pending one that carried a stale grant; not the owner.
    expect(Object.keys(recorded).sort()).toEqual([
      'admin1',
      'admin2',
      'member1',
      'member2',
      'member3',
      'member4',
      'member5',
      'pending1',
    ]);
    expect(recorded.admin1).toMatchObject({
      previousRole: 'ADMIN',
      newRole: 'Admin',
      moduleGrants: [],
    });
    expect(recorded.member2).toMatchObject({
      previousRole: 'MEMBER',
      newRole: 'Membre + Événements',
      moduleGrants: [{ module: 'events', grantedByLogin: 'admin1' }],
    });
    expect(recorded.member2?.moduleGrants[0]?.grantedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(recorded.member4?.moduleGrants.map((grant) => grant.module)).toEqual([
      'events',
      'finance',
    ]);
    expect(recorded.pending1).toMatchObject({ previousRole: 'PENDING', newRole: null });
  });

  it('is deterministic: the same legacy data always gives the same roles', async () => {
    const first = await legacyDatabase();
    const second = await legacyDatabase();
    for (const client of [first, second]) {
      await seedLegacyAccounts(client);
      await client.query(migrationSql(TARGET));
    }

    expect(await roles(second)).toEqual(await roles(first));
    expect(await accounts(second)).toEqual(await accounts(first));
  });

  it('removes the old model completely', async () => {
    const client = await legacyDatabase();
    await seedLegacyAccounts(client);
    await client.query(migrationSql(TARGET));

    const tables = await client.query(`SELECT to_regclass('"ModulePermission"') AS "t"`);
    expect(tables.rows[0]?.t).toBeNull();
    const types = await client.query<{ typname: string }>(
      `SELECT typname FROM pg_type WHERE typname IN ('Role_old', 'UserStatus') ORDER BY typname`,
    );
    expect(types.rows.map((row) => row.typname)).toEqual(['UserStatus']);
    const columns = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'role'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  describe('database guards after the migration', () => {
    async function migrated() {
      const client = await legacyDatabase();
      await seedLegacyAccounts(client);
      await client.query(migrationSql(TARGET));
      return client;
    }

    it('refuses a member without a role', async () => {
      const client = await migrated();
      await expect(
        client.query(`UPDATE "User" SET "roleId" = NULL WHERE "login" = 'member1'`),
      ).rejects.toThrow(/User_member_has_role/);
    });

    it('refuses a role on an owner or a pending account', async () => {
      const client = await migrated();
      await expect(
        client.query(`UPDATE "User" SET "roleId" = 'role-member' WHERE "login" = 'owner1'`),
      ).rejects.toThrow(/User_member_has_role/);
      await expect(
        client.query(`UPDATE "User" SET "roleId" = 'role-member' WHERE "login" = 'pending1'`),
      ).rejects.toThrow(/User_member_has_role/);
    });

    it('refuses deleting a role that is still held', async () => {
      const client = await migrated();
      await expect(client.query(`DELETE FROM "Role" WHERE "id" = 'role-member'`)).rejects.toThrow(
        /foreign key/i,
      );
    });

    it('refuses a second default role', async () => {
      const client = await migrated();
      await expect(
        client.query(`UPDATE "Role" SET "isDefault" = true WHERE "id" = 'role-admin'`),
      ).rejects.toThrow(/Role_single_default/);
    });

    it('refuses two roles with the same name', async () => {
      const client = await migrated();
      await expect(
        client.query(
          `INSERT INTO "Role" ("id", "name", "updatedAt") VALUES ('x', 'Admin', CURRENT_TIMESTAMP)`,
        ),
      ).rejects.toThrow(/Role_name_key/);
    });
  });
});
