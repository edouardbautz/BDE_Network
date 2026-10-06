import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedClub, type FakeRolesDb } from '@/test/fake-roles-db';

/**
 * The transaction wrapper every roles and members action goes through. The rules themselves
 * are in guards.test.ts; what actions can and cannot do is in escalation.test.ts.
 */

vi.mock('@/lib/prisma', async () => {
  const { createFakeRolesDb } = await import('@/test/fake-roles-db');
  const fake = createFakeRolesDb();
  return { prisma: fake.prisma, fakeDb: fake };
});
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getEffectiveSession: vi.fn(),
}));
vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ modules: { enabled: ['events'] } })) }));

const { fakeDb: db } = (await import('@/lib/prisma')) as unknown as { fakeDb: FakeRolesDb };
const { getEffectiveSession } = await import('@/lib/auth/session');
const { execute, executeToResult } = await import('./execute');
const { RoleRuleError } = await import('./errors');

function actAs(login: string) {
  vi.mocked(getEffectiveSession).mockResolvedValue(db.sessionOf(login, ['events']));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.state.roles.length = 0;
  db.state.users.length = 0;
  db.state.audit.length = 0;
  seedClub(db);
});

describe('execute', () => {
  it('hands the work the actor, read from the database, and returns its value', async () => {
    actAs('sec');

    const result = await execute('members.manage', async ({ actor, modules, simulatedAs }) => ({
      login: actor.login,
      roleId: actor.roleId,
      canManageRoles: actor.set.keys.has('roles.manage'),
      all: actor.set.all,
      modules,
      simulatedAs,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        login: 'sec',
        roleId: 'role-secretary',
        canManageRoles: false,
        all: false,
        modules: ['events'],
        simulatedAs: null,
      },
    });
  });

  it('gives an owner no role and every permission', async () => {
    actAs('owner');

    const result = await execute('roles.manage', async ({ actor }) => ({
      roleId: actor.roleId,
      all: actor.set.all,
    }));

    expect(result).toEqual({ ok: true, value: { roleId: null, all: true } });
  });

  it.each([
    ['without a session', () => vi.mocked(getEffectiveSession).mockResolvedValue(null)],
    ['for a pending account', () => actAs('pend')],
    ['for a member without the permission', () => actAs('mem')],
  ])('throws Forbidden %s, before any transaction', async (_label, arrange) => {
    arrange();
    const before = db.transactionRuns;

    await expect(execute('members.manage', async () => 'done')).rejects.toThrow('Forbidden');

    expect(db.transactionRuns).toBe(before);
  });

  it('throws Forbidden for a permission nobody holds, even the owner’s session cannot invent one', async () => {
    actAs('owner');
    await expect(execute('audit.view', async () => 'done')).rejects.toThrow('Forbidden');
  });

  it('reports a refusal as a code, and rolls the work back', async () => {
    actAs('adm');

    const result = await execute('members.manage', async ({ tx }) => {
      await tx.user.update({ where: { id: 'u_mem' }, data: { roleId: 'role-events' } });
      throw new RoleRuleError('cannotGrant');
    });

    expect(result).toEqual({ ok: false, error: 'cannotGrant' });
    expect(db.user('mem')?.roleId).toBe('role-member');
  });

  it('turns a unique-constraint failure into a conflict (two people creating the same role)', async () => {
    actAs('adm');
    db.tx.role.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 'P2002' }),
    );

    const result = await execute('roles.manage', async ({ tx }) =>
      tx.role.create({ data: { name: 'Doublon' } }),
    );

    expect(result).toEqual({ ok: false, error: 'conflict' });
  });

  it('lets a real bug through instead of hiding it', async () => {
    actAs('adm');
    await expect(
      execute('members.manage', async () => {
        throw new TypeError('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('asks for a serializable transaction', async () => {
    actAs('adm');
    await execute('members.manage', async () => undefined);
    expect(db.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
});

describe('executeToResult', () => {
  it('reduces the outcome to ok / the reason', async () => {
    actAs('adm');
    await expect(executeToResult('members.manage', async () => 'ignored')).resolves.toEqual({
      ok: true,
    });
    await expect(
      executeToResult('members.manage', async () => {
        throw new RoleRuleError('ownRole');
      }),
    ).resolves.toEqual({ ok: false, error: 'ownRole' });
  });
});
