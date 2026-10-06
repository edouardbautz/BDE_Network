import { vi } from 'vitest';
import type { UserStatus } from '@/generated/prisma/client';
import { accessFor } from '@/lib/auth/access';
import type { EffectiveSession } from '@/lib/auth/session';

/**
 * An in-memory database for the tests of roles and members: just the tables, queries and
 * guarantees these features use, with the behaviour that matters for security.
 *
 * - Prisma semantics: a filter whose value is `undefined` is not applied.
 * - Transactions roll back: if the callback throws, every write of the transaction is undone.
 * - The database guards of the real migration exist: a member must have a role and nobody
 *   else may, only one default role, unique names, and a role that is still held cannot be
 *   deleted. A bug in the application therefore shows up as a failing test instead of being
 *   absorbed.
 * - Serialization failures (Prisma's P2034) can be injected to test the retry.
 */

type Row = Record<string, unknown>;

export interface FakeRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  allPermissions: boolean;
  isDefault: boolean;
}

export interface FakeUser {
  id: string;
  login: string;
  status: UserStatus;
  roleId: string | null;
  fullName: string;
  email: string;
  campus: string;
}

export interface FakeAuditEntry {
  actorLogin: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | undefined;
}

interface State {
  roles: FakeRole[];
  users: FakeUser[];
  audit: FakeAuditEntry[];
}

function databaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function createFakeRolesDb() {
  let state: State = { roles: [], users: [], audit: [] };
  let nextId = 1;
  let serializationFailures = 0;
  /** Number of times a transaction callback ran, retries included. */
  let transactionRuns = 0;

  const matches = (record: object, where: Row = {}): boolean => {
    const row = record as Row;
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true; // Prisma drops an undefined filter
      if (key === 'NOT') return !matches(row, value as Row);
      if (key === 'name' && typeof value === 'object' && value !== null) {
        const { equals, mode } = value as { equals: string; mode?: string };
        return mode === 'insensitive'
          ? String(row.name).toLowerCase() === equals.toLowerCase()
          : row.name === equals;
      }
      return row[key] === value;
    });
  };

  const withRole = (user: FakeUser | undefined, args: { include?: Row } = {}) => {
    if (!user) return null;
    return args.include?.role
      ? { ...user, role: state.roles.find((role) => role.id === user.roleId) ?? null }
      : { ...user };
  };

  /** The guarantees the migration puts in the database. */
  function assertDatabaseGuards(): void {
    for (const user of state.users) {
      if ((user.status === 'MEMBER') !== (user.roleId !== null)) {
        throw databaseError('23514', 'violates check constraint "User_member_has_role"');
      }
      if (user.roleId !== null && !state.roles.some((role) => role.id === user.roleId)) {
        throw databaseError('P2003', 'Foreign key constraint violated on User_roleId_fkey');
      }
    }
    if (state.roles.filter((role) => role.isDefault).length > 1) {
      throw databaseError('P2002', 'Unique constraint failed: Role_single_default');
    }
    const names = state.roles.map((role) => role.name);
    if (new Set(names).size !== names.length) {
      throw databaseError('P2002', 'Unique constraint failed: Role_name_key');
    }
  }

  const tx = {
    role: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const role = state.roles.find((candidate) => matches(candidate, where));
        return role ? { ...role } : null;
      }),
      findFirst: vi.fn(async ({ where }: { where?: Row } = {}) => {
        const role = state.roles.find((candidate) => matches(candidate, where));
        return role ? { ...role } : null;
      }),
      findMany: vi.fn(async ({ where }: { where?: Row } = {}) =>
        state.roles.filter((role) => matches(role, where)).map((role) => ({ ...role })),
      ),
      create: vi.fn(async ({ data }: { data: Partial<FakeRole> }) => {
        const role: FakeRole = {
          id: `role-new-${nextId++}`,
          name: String(data.name),
          description: data.description ?? null,
          permissions: [...(data.permissions ?? [])],
          allPermissions: data.allPermissions ?? false,
          isDefault: data.isDefault ?? false,
        };
        state.roles.push(role);
        assertDatabaseGuards();
        return { ...role };
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Partial<FakeRole> }) => {
        const role = state.roles.find((candidate) => matches(candidate, where));
        if (!role) throw databaseError('P2025', 'Record not found');
        Object.assign(role, data);
        assertDatabaseGuards();
        return { ...role };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Partial<FakeRole> }) => {
        const rows = state.roles.filter((candidate) => matches(candidate, where));
        for (const row of rows) Object.assign(row, data);
        assertDatabaseGuards();
        return { count: rows.length };
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const role = state.roles.find((candidate) => matches(candidate, where));
        if (!role) throw databaseError('P2025', 'Record not found');
        state.roles = state.roles.filter((candidate) => candidate !== role);
        assertDatabaseGuards(); // a role still held cannot go
        return { ...role };
      }),
    },
    user: {
      findUnique: vi.fn(async (args: { where: Row; include?: Row }) =>
        withRole(
          state.users.find((candidate) => matches(candidate, args.where)),
          args,
        ),
      ),
      count: vi.fn(
        async ({ where }: { where?: Row } = {}) =>
          state.users.filter((user) => matches(user, where)).length,
      ),
      update: vi.fn(async ({ where, data }: { where: Row; data: Partial<FakeUser> }) => {
        const user = state.users.find((candidate) => matches(candidate, where));
        if (!user) throw databaseError('P2025', 'Record not found');
        Object.assign(user, data);
        assertDatabaseGuards();
        return { ...user };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Partial<FakeUser> }) => {
        const rows = state.users.filter((candidate) => matches(candidate, where));
        for (const row of rows) Object.assign(row, data);
        assertDatabaseGuards();
        return { count: rows.length };
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const user = state.users.find((candidate) => matches(candidate, where));
        if (!user) throw databaseError('P2025', 'Record not found');
        state.users = state.users.filter((candidate) => candidate !== user);
        return { ...user };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (typeof data.actorLogin !== 'string' || typeof data.action !== 'string') {
          throw databaseError('P2012', 'Missing a required value');
        }
        state.audit.push({
          actorLogin: data.actorLogin,
          actorId: (data.actorId as string | null) ?? null,
          action: data.action,
          targetType: String(data.targetType),
          targetId: (data.targetId as string | null) ?? null,
          targetLabel: (data.targetLabel as string | null) ?? null,
          metadata: data.metadata as Record<string, unknown> | undefined,
        });
        return {};
      }),
    },
  };

  /** Transactions run one after the other: the outcome a SERIALIZABLE transaction guarantees. */
  let queue: Promise<unknown> = Promise.resolve();

  /** Runs `callback` and undoes every write if it throws, like a real transaction. */
  const transaction = vi.fn(
    <T>(callback: (client: typeof tx) => Promise<T>, options?: { isolationLevel?: string }) => {
      void options;
      const run = queue.then(async () => {
        if (serializationFailures > 0) {
          serializationFailures -= 1;
          throw databaseError('P2034', 'Transaction failed due to a write conflict or a deadlock');
        }
        transactionRuns += 1;
        const snapshot = structuredClone(state);
        try {
          return await callback(tx);
        } catch (error) {
          state = snapshot;
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  );

  const prisma = { $transaction: transaction, ...tx };

  return {
    prisma,
    tx,
    get state() {
      return state;
    },
    get transactionRuns() {
      return transactionRuns;
    },
    /** The next `count` transactions fail to serialize before running. */
    failToSerialize(count: number) {
      serializationFailures = count;
    },
    addRole(role: Partial<FakeRole> & Pick<FakeRole, 'id' | 'name'>): FakeRole {
      const full: FakeRole = {
        description: null,
        permissions: [],
        allPermissions: false,
        isDefault: false,
        ...role,
      };
      state.roles.push(full);
      return full;
    },
    addUser(user: Partial<FakeUser> & Pick<FakeUser, 'login'>): FakeUser {
      const full: FakeUser = {
        id: `u_${user.login}`,
        status: 'MEMBER',
        roleId: null,
        fullName: user.login,
        email: `${user.login}@example.org`,
        campus: 'Paris',
        ...user,
      };
      state.users.push(full);
      assertDatabaseGuards();
      return full;
    },
    user: (login: string): FakeUser | undefined => state.users.find((user) => user.login === login),
    role: (id: string): FakeRole | undefined => state.roles.find((role) => role.id === id),
    roleByName: (name: string): FakeRole | undefined =>
      state.roles.find((role) => role.name === name),
    /** The session the app would build for this account *right now*, from what is in the database. */
    sessionOf(login: string, modules: readonly string[]): EffectiveSession {
      const user = state.users.find((candidate) => candidate.login === login);
      if (!user) throw new Error(`no such account: ${login}`);
      const role = state.roles.find((candidate) => candidate.id === user.roleId) ?? null;
      const access = accessFor({ status: user.status, roleId: user.roleId, role }, modules);
      return {
        user: {
          id: user.id,
          login: user.login,
          campus: user.campus,
          name: user.fullName,
          email: user.email,
          image: null,
          ...access,
        },
        isImpersonating: false,
        simulatedAs: null,
        realStatus: user.status,
      };
    },
  };
}

export type FakeRolesDb = ReturnType<typeof createFakeRolesDb>;

/**
 * A BDE with a few roles and people, to play the scenarios on:
 *
 *   Admin            all permissions                         adm
 *   Président        members + roles + all of events         pres
 *   Secrétaire       members.manage + events view/manage     sec, sec2 (two colleagues)
 *   Resp. événements events view/manage/shared calendar      evt
 *   Gestion rôles    roles.manage + events.view              rolesadmin
 *   Membre (default) events.view                             mem, mem2
 *   (owner: all, from the config) owner     (pending request) pend
 */
export function seedClub(db: FakeRolesDb): void {
  db.addRole({ id: 'role-admin', name: 'Admin', allPermissions: true });
  db.addRole({
    id: 'role-president',
    name: 'Président',
    permissions: [
      'members.manage',
      'roles.manage',
      'events.view',
      'events.manage',
      'events.shared_calendar',
    ],
  });
  db.addRole({
    id: 'role-secretary',
    name: 'Secrétaire',
    permissions: ['members.manage', 'events.view', 'events.manage'],
  });
  db.addRole({
    id: 'role-events',
    name: 'Resp. événements',
    permissions: ['events.view', 'events.manage', 'events.shared_calendar'],
  });
  db.addRole({
    id: 'role-rolesadmin',
    name: 'Gestion rôles',
    permissions: ['roles.manage', 'events.view'],
  });
  db.addRole({ id: 'role-member', name: 'Membre', permissions: ['events.view'], isDefault: true });

  db.addUser({ login: 'owner', status: 'OWNER' });
  db.addUser({ login: 'adm', roleId: 'role-admin' });
  db.addUser({ login: 'pres', roleId: 'role-president' });
  db.addUser({ login: 'sec', roleId: 'role-secretary' });
  db.addUser({ login: 'sec2', roleId: 'role-secretary' });
  db.addUser({ login: 'evt', roleId: 'role-events' });
  db.addUser({ login: 'rolesadmin', roleId: 'role-rolesadmin' });
  db.addUser({ login: 'mem', roleId: 'role-member' });
  db.addUser({ login: 'mem2', roleId: 'role-member' });
  db.addUser({ login: 'pend', status: 'PENDING' });
}
