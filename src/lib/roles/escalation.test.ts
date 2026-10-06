import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessFor } from '@/lib/auth/access';
import type { EffectiveSession } from '@/lib/auth/session';
import { seedClub, type FakeRolesDb } from '@/test/fake-roles-db';

/**
 * Privilege escalation, end to end: the real server actions of the roles and members pages,
 * the real transaction wrapper and the real rules, against an in-memory database that refuses
 * what PostgreSQL would refuse (see test/fake-roles-db.ts).
 *
 * Every refusal is checked three ways: the reason, the database left exactly as it was, and no
 * audit entry. A scenario that passes for the wrong reason would show up in one of the three.
 *
 * The club (test/fake-roles-db.ts, seedClub):
 *   adm        Admin             all permissions
 *   pres       Président         members + roles + all of events      (not "all")
 *   sec, sec2  Secrétaire        members.manage + events view/manage  (two colleagues)
 *   evt        Resp. événements  events view/manage/shared calendar
 *   rolesadmin Gestion rôles     roles.manage + events.view
 *   mem, mem2  Membre            events.view (the default role)
 *   owner      OWNER             everything, from the config
 *   pend       a pending request
 */

const { RedirectSignal, afterCallbacks } = vi.hoisted(() => ({
  RedirectSignal: class RedirectSignal extends Error {},
  /** What the actions scheduled to run after their response. */
  afterCallbacks: [] as Array<() => unknown>,
}));

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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback);
  }),
}));
vi.mock('@/lib/members/notifications', () => ({
  notifyMemberApproved: vi.fn(),
  notifyMemberRemoved: vi.fn(),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw new RedirectSignal();
  }),
}));

const { fakeDb: db } = (await import('@/lib/prisma')) as unknown as { fakeDb: FakeRolesDb };
const { getEffectiveSession } = await import('@/lib/auth/session');
const members = await import('@/app/[locale]/(app)/members/actions');
const rolePages = await import('@/app/[locale]/(app)/roles/actions');

const { notifyMemberApproved, notifyMemberRemoved } = await import('@/lib/members/notifications');

const MODULES = ['events'];

/** Runs what the last actions scheduled for after their response, as Next would. */
async function runAfter(): Promise<void> {
  for (const callback of afterCallbacks.splice(0)) await callback();
}

/** The next request comes from this account, with the rights it holds right now. */
function actAs(login: string): EffectiveSession {
  const session = db.sessionOf(login, MODULES);
  vi.mocked(getEffectiveSession).mockResolvedValue(session);
  return session;
}

function roleForm(values: {
  name?: string;
  description?: string;
  allPermissions?: boolean;
  permissions?: string[];
}): FormData {
  const data = new FormData();
  data.set('name', values.name ?? 'Nouveau rôle');
  data.set('description', values.description ?? '');
  if (values.allPermissions) data.set('allPermissions', 'on');
  for (const permission of values.permissions ?? []) data.append('permissions', permission);
  return data;
}

const actions = () => db.state.audit.map((entry) => entry.action);

/** Runs `attempt`, then checks it changed nothing and logged nothing. */
async function expectUntouched(attempt: () => Promise<unknown>): Promise<void> {
  const before = structuredClone(db.state);
  await attempt();
  expect(db.state).toEqual(before);
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  db.state.roles.length = 0;
  db.state.users.length = 0;
  db.state.audit.length = 0;
  seedClub(db);
});

describe('assigning a role to a member', () => {
  it('lets a secretary move a member to a role within the secretary’s own rights, and logs it', async () => {
    db.addRole({
      id: 'role-helper',
      name: 'Aide événements',
      permissions: ['events.view', 'events.manage'],
    });
    actAs('sec');

    await expect(members.changeMemberRole('u_mem', 'role-helper')).resolves.toEqual({ ok: true });

    expect(db.user('mem')?.roleId).toBe('role-helper');
    expect(db.state.audit).toEqual([
      expect.objectContaining({
        actorLogin: 'sec',
        actorId: 'u_sec',
        action: 'member.role_change',
        targetLabel: 'mem',
        metadata: { from: 'Membre', to: 'Aide événements' },
      }),
    ]);
  });

  it('does nothing, and logs nothing, when the member already has that role', async () => {
    actAs('sec');
    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-member')).resolves.toEqual({ ok: true });
    });
  });

  describe('refused', () => {
    it.each([
      ['a secretary giving the Président role', 'sec', 'u_mem', 'role-president', 'cannotGrant'],
      ['a secretary giving the Admin role', 'sec', 'u_mem', 'role-admin', 'cannotGrant'],
      [
        'a president giving the Admin role (all permissions)',
        'pres',
        'u_mem',
        'role-admin',
        'cannotGrant',
      ],
    ])('%s', async (_label, actor, target, role, error) => {
      actAs(actor);
      await expectUntouched(async () => {
        await expect(members.changeMemberRole(target, role)).resolves.toEqual({ ok: false, error });
      });
      expect(actions()).toEqual([]);
    });

    it.each([
      ['a secretary', 'sec', 'role-member'],
      ['a secretary, even to the same rights', 'sec', 'role-secretary'],
      ['an admin', 'adm', 'role-member'],
      ['a president promoting themselves', 'pres', 'role-admin'],
    ])('changing one’s own role: %s', async (_label, actor, role) => {
      actAs(actor);
      await expectUntouched(async () => {
        await expect(members.changeMemberRole(`u_${actor}`, role)).resolves.toEqual({
          ok: false,
          error: 'targetIsSelf',
        });
      });
    });

    it('demoting a superior: a secretary cannot move the president to a lesser role', async () => {
      actAs('sec');
      await expectUntouched(async () => {
        await expect(members.changeMemberRole('u_pres', 'role-member')).resolves.toEqual({
          ok: false,
          error: 'cannotManageMember',
        });
      });
      expect(actions()).toEqual([]);
    });

    it('demoting an admin: a president cannot move an admin (they do not hold "all")', async () => {
      actAs('pres');
      await expectUntouched(async () => {
        await expect(members.changeMemberRole('u_adm', 'role-member')).resolves.toEqual({
          ok: false,
          error: 'cannotManageMember',
        });
      });
    });

    it('touching an owner, or a pending request (those go through approval)', async () => {
      actAs('adm');
      await expectUntouched(async () => {
        await expect(members.changeMemberRole('u_owner', 'role-member')).resolves.toEqual({
          ok: false,
          error: 'targetIsOwner',
        });
        await expect(members.changeMemberRole('u_pend', 'role-member')).resolves.toEqual({
          ok: false,
          error: 'targetNotMember',
        });
      });
    });

    it('unknown member or role', async () => {
      actAs('adm');
      await expectUntouched(async () => {
        await expect(members.changeMemberRole('u_nobody', 'role-member')).resolves.toEqual({
          ok: false,
          error: 'targetNotFound',
        });
        await expect(members.changeMemberRole('u_mem', 'role-nothing')).resolves.toEqual({
          ok: false,
          error: 'roleNotFound',
        });
      });
    });

    it('ids that are not plain strings never reach the database', async () => {
      actAs('adm');
      const before = db.transactionRuns;
      for (const bad of [undefined, null, '', 42, { id: 'u_mem' }, ['u_mem'], 'x'.repeat(65)]) {
        await expect(
          members.changeMemberRole(bad as unknown as string, 'role-member'),
        ).resolves.toMatchObject({ ok: false });
        await expect(
          members.changeMemberRole('u_mem', bad as unknown as string),
        ).resolves.toMatchObject({ ok: false });
      }
      expect(db.transactionRuns).toBe(before);
    });

    it('anyone without members.manage is stopped at the door', async () => {
      for (const login of ['mem', 'evt', 'rolesadmin', 'pend']) {
        actAs(login);
        await expectUntouched(async () => {
          await expect(members.changeMemberRole('u_mem2', 'role-events')).rejects.toThrow(
            'Forbidden',
          );
        });
      }
    });
  });

  it('lets colleagues with the same rights move each other, and the owner and admins move anyone', async () => {
    actAs('sec');
    await expect(members.changeMemberRole('u_sec2', 'role-member')).resolves.toEqual({ ok: true });

    actAs('adm');
    await expect(members.changeMemberRole('u_pres', 'role-member')).resolves.toEqual({ ok: true });

    actAs('owner');
    await expect(members.changeMemberRole('u_adm', 'role-president')).resolves.toEqual({
      ok: true,
    });
    expect(actions()).toEqual(['member.role_change', 'member.role_change', 'member.role_change']);
  });
});

describe('approving, refusing and removing', () => {
  it('approves a pending request with a role the approver could give, and logs the role', async () => {
    actAs('sec');

    await expect(members.approveMember('u_pend', 'role-member')).resolves.toEqual({ ok: true });

    expect(db.user('pend')).toMatchObject({ status: 'MEMBER', roleId: 'role-member' });
    expect(db.state.audit[0]).toMatchObject({
      action: 'member.approve',
      actorLogin: 'sec',
      targetLabel: 'pend',
      metadata: { role: 'Membre' },
    });
  });

  it('refuses to approve with a role above the approver', async () => {
    actAs('sec');
    await expectUntouched(async () => {
      await expect(members.approveMember('u_pend', 'role-president')).resolves.toEqual({
        ok: false,
        error: 'cannotGrant',
      });
      await expect(members.approveMember('u_pend', 'role-admin')).resolves.toEqual({
        ok: false,
        error: 'cannotGrant',
      });
    });
  });

  it('only approves what is pending: a second approval, or a member, an owner', async () => {
    actAs('adm');
    await expect(members.approveMember('u_pend', 'role-member')).resolves.toEqual({ ok: true });
    await expectUntouched(async () => {
      await expect(members.approveMember('u_pend', 'role-events')).resolves.toEqual({
        ok: false,
        error: 'targetNotPending',
      });
      await expect(members.approveMember('u_mem', 'role-events')).resolves.toEqual({
        ok: false,
        error: 'targetNotPending',
      });
      await expect(members.approveMember('u_owner', 'role-events')).resolves.toEqual({
        ok: false,
        error: 'targetNotPending',
      });
    });
  });

  it('refuses a pending request: the row goes, and it is logged', async () => {
    actAs('sec');
    await expect(members.rejectMember('u_pend')).resolves.toEqual({ ok: true });
    expect(db.user('pend')).toBeUndefined();
    expect(actions()).toEqual(['member.reject']);
  });

  it('rejects only pending requests', async () => {
    actAs('adm');
    await expectUntouched(async () => {
      await expect(members.rejectMember('u_mem')).resolves.toEqual({
        ok: false,
        error: 'targetNotPending',
      });
      await expect(members.rejectMember('u_owner')).resolves.toEqual({
        ok: false,
        error: 'targetIsOwner',
      });
    });
  });

  it('removes a member whose role the actor covers, and logs the role they had', async () => {
    actAs('sec');
    await expect(members.removeMember('u_mem')).resolves.toEqual({ ok: true, login: 'mem' });
    expect(db.user('mem')).toBeUndefined();
    expect(db.state.audit[0]).toMatchObject({
      action: 'member.remove',
      targetLabel: 'mem',
      metadata: { role: 'Membre' },
    });
  });

  it.each([
    ['a secretary removing the president', 'sec', 'u_pres', 'cannotManageMember'],
    ['a secretary removing an admin', 'sec', 'u_adm', 'cannotManageMember'],
    ['a president removing an admin', 'pres', 'u_adm', 'cannotManageMember'],
    ['an admin removing themselves', 'adm', 'u_adm', 'targetIsSelf'],
    ['a secretary removing themselves', 'sec', 'u_sec', 'targetIsSelf'],
    ['an admin removing the owner', 'adm', 'u_owner', 'targetIsOwner'],
    ['removing someone who is only pending', 'adm', 'u_pend', 'targetNotMember'],
    ['removing nobody', 'adm', 'u_nobody', 'targetNotFound'],
  ])('%s', async (_label, actor, target, error) => {
    actAs(actor);
    await expectUntouched(async () => {
      await expect(members.removeMember(target)).resolves.toEqual({ ok: false, error });
    });
  });

  it('lets a colleague remove a colleague, and an owner remove an admin', async () => {
    actAs('sec');
    await expect(members.removeMember('u_sec2')).resolves.toMatchObject({ ok: true });
    actAs('owner');
    await expect(members.removeMember('u_adm')).resolves.toMatchObject({ ok: true });
  });

  it('stops anyone without members.manage', async () => {
    for (const login of ['mem', 'evt', 'rolesadmin']) {
      actAs(login);
      await expectUntouched(async () => {
        await expect(members.removeMember('u_mem2')).rejects.toThrow('Forbidden');
        await expect(members.approveMember('u_pend', 'role-member')).rejects.toThrow('Forbidden');
        await expect(members.rejectMember('u_pend')).rejects.toThrow('Forbidden');
      });
    }
  });
});

describe('creating a role', () => {
  const create = (values: Parameters<typeof roleForm>[0]) =>
    rolePages.createRole({}, roleForm(values));

  it('lets someone with roles.manage create a role within their own rights, and logs it', async () => {
    actAs('rolesadmin');

    await expect(create({ name: 'Bénévole', permissions: ['events.view'] })).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(db.roleByName('Bénévole')).toMatchObject({
      permissions: ['events.view'],
      allPermissions: false,
      isDefault: false,
    });
    expect(db.state.audit[0]).toMatchObject({
      action: 'role.create',
      actorLogin: 'rolesadmin',
      targetLabel: 'Bénévole',
    });
  });

  it('stores what a permission implies, and nothing else', async () => {
    actAs('pres');
    await expect(create({ name: 'Orga', permissions: ['events.manage'] })).rejects.toBeInstanceOf(
      RedirectSignal,
    );
    expect(db.roleByName('Orga')?.permissions).toEqual(['events.manage', 'events.view']);
  });

  it.each([
    [
      'a permission the creator lacks (events.manage)',
      'rolesadmin',
      { permissions: ['events.view', 'events.manage'] },
    ],
    ['members.manage, which the creator lacks', 'rolesadmin', { permissions: ['members.manage'] }],
    [
      'all permissions, from a president (who holds a long list, not "all")',
      'pres',
      { allPermissions: true },
    ],
    [
      'all permissions, from a creator who does not hold all',
      'rolesadmin',
      { allPermissions: true },
    ],
  ])('refuses %s', async (_label, actor, values) => {
    actAs(actor);
    await expectUntouched(async () => {
      await expect(create({ name: 'Piège', ...values })).resolves.toMatchObject({
        error: 'cannotGrant',
      });
    });
  });

  it('lets an admin and the owner create a role with all permissions', async () => {
    actAs('adm');
    await expect(create({ name: 'Super', allPermissions: true })).rejects.toBeInstanceOf(
      RedirectSignal,
    );
    actAs('owner');
    await expect(create({ name: 'Super 2', allPermissions: true })).rejects.toBeInstanceOf(
      RedirectSignal,
    );
    expect(db.roleByName('Super')?.allPermissions).toBe(true);
  });

  it('refuses a permission that does not exist, whoever asks (a tampered request)', async () => {
    actAs('owner');
    for (const key of ['audit.view', 'owner', '*', 'finance.manage', 'members.manage ']) {
      await expectUntouched(async () => {
        await expect(create({ name: 'Piège', permissions: [key] })).resolves.toMatchObject({
          fieldErrors: { permissions: 'unknown' },
        });
      });
    }
  });

  it('keeps names unique, whatever their case', async () => {
    actAs('adm');
    await expectUntouched(async () => {
      await expect(create({ name: 'secrétaire' })).resolves.toMatchObject({ error: 'nameTaken' });
      await expect(create({ name: 'ADMIN' })).resolves.toMatchObject({ error: 'nameTaken' });
    });
  });

  it('validates the fields and keeps what was typed', async () => {
    actAs('adm');
    const result = await create({ name: '   ', description: 'x'.repeat(201) });
    expect(result).toMatchObject({
      fieldErrors: { name: 'required', description: 'tooLong' },
      values: { description: 'x'.repeat(201) },
    });
    expect(db.state.roles).toHaveLength(6);
  });

  it('stops anyone without roles.manage', async () => {
    for (const login of ['mem', 'sec', 'evt', 'pend']) {
      actAs(login);
      await expectUntouched(async () => {
        await expect(create({ name: 'Piège' })).rejects.toThrow('Forbidden');
      });
    }
  });
});

describe('editing a role', () => {
  const update = (id: string, values: Parameters<typeof roleForm>[0]) =>
    rolePages.updateRole(id, {}, roleForm(values));

  it('lets a president edit a role they fully cover, and logs exactly what changed', async () => {
    actAs('pres');

    await expect(
      update('role-events', { name: 'Resp. soirées', permissions: ['events.view'] }),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(db.role('role-events')).toMatchObject({
      name: 'Resp. soirées',
      permissions: ['events.view'],
    });
    expect(db.state.audit[0]).toMatchObject({
      action: 'role.update',
      actorLogin: 'pres',
      metadata: {
        changes: {
          name: { from: 'Resp. événements', to: 'Resp. soirées' },
          permissionsRemoved: ['events.manage', 'events.shared_calendar'],
        },
      },
    });
  });

  it('writes and logs nothing when nothing changes', async () => {
    actAs('pres');
    await expectUntouched(async () => {
      await expect(
        update('role-member', { name: 'Membre', permissions: ['events.view'] }),
      ).rejects.toBeInstanceOf(RedirectSignal);
    });
  });

  describe('refused', () => {
    it.each([
      [
        'their own role, even to remove a permission',
        'rolesadmin',
        'role-rolesadmin',
        { name: 'Gestion rôles', permissions: ['events.view'] },
        'ownRole',
      ],
      [
        'their own role, even a rename',
        'pres',
        'role-president',
        {
          name: 'Chef',
          permissions: [
            'members.manage',
            'roles.manage',
            'events.manage',
            'events.shared_calendar',
          ],
        },
        'ownRole',
      ],
      [
        'a role above them (stripping a superior)',
        'rolesadmin',
        'role-president',
        { name: 'Président', permissions: [] },
        'cannotManageRole',
      ],
      [
        'a role with rights they lack, even to rename it',
        'rolesadmin',
        'role-events',
        { name: 'Resp.', permissions: ['events.view', 'events.manage', 'events.shared_calendar'] },
        'cannotManageRole',
      ],
      [
        'the Admin role (all permissions)',
        'pres',
        'role-admin',
        { name: 'Admin', allPermissions: true },
        'cannotManageRole',
      ],
    ])('editing %s', async (_label, actor, roleId, values, error) => {
      actAs(actor);
      await expectUntouched(async () => {
        await expect(update(roleId, values)).resolves.toMatchObject({ error });
      });
    });

    it('smuggling a permission into a lower role: adding events.manage without holding it', async () => {
      actAs('rolesadmin');
      await expectUntouched(async () => {
        await expect(
          update('role-member', { name: 'Membre', permissions: ['events.view', 'events.manage'] }),
        ).resolves.toMatchObject({ error: 'cannotGrant' });
      });
    });

    it('turning a role into "all permissions" without holding all', async () => {
      actAs('pres');
      await expectUntouched(async () => {
        await expect(
          update('role-member', { name: 'Membre', allPermissions: true }),
        ).resolves.toMatchObject({ error: 'cannotGrant' });
      });
    });

    it('a permission that does not exist, and a role that does not exist', async () => {
      actAs('adm');
      await expectUntouched(async () => {
        await expect(
          update('role-member', { name: 'Membre', permissions: ['audit.view'] }),
        ).resolves.toMatchObject({ fieldErrors: { permissions: 'unknown' } });
        await expect(update('role-nothing', { name: 'X' })).resolves.toMatchObject({
          error: 'roleNotFound',
        });
        await expect(update('', { name: 'X' })).resolves.toMatchObject({ error: 'roleNotFound' });
      });
    });

    it('taking a name that another role has', async () => {
      actAs('adm');
      await expectUntouched(async () => {
        await expect(
          update('role-member', { name: 'président', permissions: ['events.view'] }),
        ).resolves.toMatchObject({ error: 'nameTaken' });
      });
    });

    it('anyone without roles.manage', async () => {
      for (const login of ['mem', 'sec', 'evt']) {
        actAs(login);
        await expectUntouched(async () => {
          await expect(update('role-member', { name: 'Membre' })).rejects.toThrow('Forbidden');
        });
      }
    });
  });

  it('lets an admin turn "all permissions" off and on, and the owner edit the admin role', async () => {
    actAs('owner');
    await expect(
      update('role-admin', { name: 'Admin', permissions: ['members.manage'] }),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(db.role('role-admin')).toMatchObject({
      allPermissions: false,
      permissions: ['members.manage'],
    });
    await expect(
      update('role-admin', { name: 'Admin', allPermissions: true }),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(db.role('role-admin')?.allPermissions).toBe(true);
  });

  describe('permissions of a module that is not enabled', () => {
    beforeEach(() => {
      db.addRole({
        id: 'role-finance',
        name: 'Trésorier',
        permissions: ['events.view', 'finance.manage', 'finance.view'],
      });
    });

    it('survive an edit, whatever the form sends', async () => {
      actAs('adm');
      await expect(
        update('role-finance', {
          name: 'Trésorier',
          permissions: ['events.view', 'events.manage'],
        }),
      ).rejects.toBeInstanceOf(RedirectSignal);
      expect(db.role('role-finance')?.permissions).toEqual([
        'events.manage',
        'events.view',
        'finance.manage',
        'finance.view',
      ]);
    });

    it('cannot be submitted: the form only offers the enabled modules', async () => {
      actAs('adm');
      await expectUntouched(async () => {
        await expect(
          update('role-finance', { name: 'Trésorier', permissions: ['finance.manage'] }),
        ).resolves.toMatchObject({ fieldErrors: { permissions: 'unknown' } });
      });
    });

    it('are not counted when deciding whether a role is covered', async () => {
      // Only the enabled modules are compared: a hidden permission neither blocks nor grants.
      actAs('rolesadmin');
      await expectUntouched(async () => {
        await expect(
          update('role-finance', { name: 'Trésorier', permissions: ['events.view'] }),
        ).rejects.toBeInstanceOf(RedirectSignal);
      });
    });
  });
});

describe('deleting a role', () => {
  beforeEach(() => {
    db.addRole({ id: 'role-spare', name: 'Spare', permissions: ['events.view'] });
  });

  it('deletes an unused role the actor covers, and logs it', async () => {
    actAs('pres');
    await expect(rolePages.deleteRole('role-spare')).resolves.toEqual({ ok: true });
    expect(db.role('role-spare')).toBeUndefined();
    expect(db.state.audit[0]).toMatchObject({ action: 'role.delete', targetLabel: 'Spare' });
  });

  it.each([
    ['a role that is still held', 'adm', 'role-events', 'roleInUse'],
    ['the default role (also still held)', 'adm', 'role-member', 'isDefault'],
    ['one’s own role', 'pres', 'role-president', 'ownRole'],
    ['a role above the actor', 'rolesadmin', 'role-president', 'cannotManageRole'],
    ['the Admin role', 'pres', 'role-admin', 'cannotManageRole'],
    ['a role that does not exist', 'adm', 'role-nothing', 'roleNotFound'],
  ])('refuses %s', async (_label, actor, roleId, error) => {
    actAs(actor);
    await expectUntouched(async () => {
      await expect(rolePages.deleteRole(roleId)).resolves.toEqual({ ok: false, error });
    });
  });

  it('refuses the default role even once nobody holds it', async () => {
    db.user('mem')!.roleId = 'role-events';
    db.user('mem2')!.roleId = 'role-events';
    actAs('adm');
    await expectUntouched(async () => {
      await expect(rolePages.deleteRole('role-member')).resolves.toEqual({
        ok: false,
        error: 'isDefault',
      });
    });
  });

  it('works once the last holder was given another role', async () => {
    actAs('pres');
    await expect(rolePages.deleteRole('role-events')).resolves.toEqual({
      ok: false,
      error: 'roleInUse',
    });
    await expect(members.changeMemberRole('u_evt', 'role-member')).resolves.toEqual({ ok: true });
    await expect(rolePages.deleteRole('role-events')).resolves.toEqual({ ok: true });
    expect(db.role('role-events')).toBeUndefined();
    expect(actions()).toEqual(['member.role_change', 'role.delete']);
  });

  it('stops anyone without roles.manage', async () => {
    for (const login of ['mem', 'sec']) {
      actAs(login);
      await expectUntouched(async () => {
        await expect(rolePages.deleteRole('role-spare')).rejects.toThrow('Forbidden');
      });
    }
  });
});

describe('the default role', () => {
  it('moves to another role, one at a time, and logs the previous one', async () => {
    actAs('pres');
    await expect(rolePages.setDefaultRole('role-secretary')).resolves.toEqual({ ok: true });

    expect(db.state.roles.filter((role) => role.isDefault).map((role) => role.id)).toEqual([
      'role-secretary',
    ]);
    expect(db.state.audit[0]).toMatchObject({
      action: 'role.set_default',
      metadata: { previous: 'Membre' },
    });
  });

  it('does nothing when the role already is the default', async () => {
    actAs('pres');
    await expectUntouched(async () => {
      await expect(rolePages.setDefaultRole('role-member')).resolves.toEqual({ ok: true });
    });
  });

  it.each([
    ['the actor’s own role', 'pres', 'role-president', 'ownRole'],
    ['a role above the actor', 'rolesadmin', 'role-secretary', 'cannotManageRole'],
    ['a role that does not exist', 'adm', 'role-nothing', 'roleNotFound'],
  ])('refuses %s', async (_label, actor, roleId, error) => {
    actAs(actor);
    await expectUntouched(async () => {
      await expect(rolePages.setDefaultRole(roleId)).resolves.toEqual({ ok: false, error });
    });
  });

  it('stops anyone without roles.manage', async () => {
    actAs('sec');
    await expectUntouched(async () => {
      await expect(rolePages.setDefaultRole('role-secretary')).rejects.toThrow('Forbidden');
    });
  });
});

describe('rights are read again from the database, not from the session', () => {
  it('refuses a secretary whose role lost members.manage after the page was drawn', async () => {
    actAs('sec'); // the session still says "members.manage"
    db.role('role-secretary')!.permissions = ['events.view', 'events.manage'];

    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-events')).rejects.toThrow('Forbidden');
    });
  });

  it('applies the actor’s current rights to what they may give', async () => {
    actAs('sec');
    db.role('role-secretary')!.permissions = ['members.manage', 'events.view']; // lost events.manage

    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-events')).resolves.toEqual({
        ok: false,
        error: 'cannotGrant',
      });
    });
  });

  it('refuses an actor who was removed, demoted to pending, or lost their role', async () => {
    actAs('sec');
    db.state.users = db.state.users.filter((user) => user.login !== 'sec');
    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-events')).rejects.toThrow('Forbidden');
    });

    actAs('adm');
    Object.assign(db.user('adm')!, { status: 'PENDING', roleId: null });
    await expectUntouched(async () => {
      await expect(members.removeMember('u_mem')).rejects.toThrow('Forbidden');
    });
  });

  it('applies a role that was edited in the meantime to the member being moved', async () => {
    actAs('sec');
    // The president’s role is edited to something the secretary now covers: the move is allowed.
    db.role('role-president')!.permissions = ['members.manage', 'events.view'];
    await expect(members.changeMemberRole('u_pres', 'role-member')).resolves.toEqual({ ok: true });
  });
});

describe('transactions', () => {
  it('retries a transaction that could not be serialized', async () => {
    actAs('adm');
    db.failToSerialize(2);
    const runsBefore = db.transactionRuns;

    await expect(members.changeMemberRole('u_mem', 'role-events')).resolves.toEqual({ ok: true });

    expect(db.transactionRuns - runsBefore).toBe(1);
    expect(db.user('mem')?.roleId).toBe('role-events');
    expect(actions()).toEqual(['member.role_change']);
  });

  it('gives up after three attempts and says it is a conflict, changing nothing', async () => {
    actAs('adm');
    db.failToSerialize(3);
    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-events')).resolves.toEqual({
        ok: false,
        error: 'conflict',
      });
    });
  });

  it('writes the change and its audit entry together: if the log fails, the change is undone', async () => {
    actAs('adm');
    db.tx.auditLog.create.mockRejectedValueOnce(new Error('disk full'));

    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-events')).rejects.toThrow('disk full');
    });
    expect(db.user('mem')?.roleId).toBe('role-member');
  });

  it('two approvals racing for the same request: one wins, the other is told it is no longer pending', async () => {
    actAs('adm');
    const results = await Promise.all([
      members.approveMember('u_pend', 'role-member'),
      members.approveMember('u_pend', 'role-events'),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: 'targetNotPending' },
    ]);
    expect(actions()).toEqual(['member.approve']);
  });
});

describe('a stale read cannot be written back', () => {
  it('approving does not overwrite someone who was approved between the read and the write', async () => {
    actAs('adm');
    // Another request has just approved "pend" with the Admin role...
    Object.assign(db.user('pend')!, { status: 'MEMBER', roleId: 'role-admin' });
    // ...but this transaction still reads the old, pending row.
    const read = db.tx.user.findUnique.getMockImplementation()!;
    db.tx.user.findUnique.mockImplementation(async (args) =>
      args.where.id === 'u_pend'
        ? {
            ...db.user('pend')!,
            status: 'PENDING' as const,
            roleId: null,
            role: null,
          }
        : read(args),
    );

    await expectUntouched(async () => {
      await expect(members.approveMember('u_pend', 'role-member')).resolves.toEqual({
        ok: false,
        error: 'targetNotPending',
      });
    });
    expect(db.user('pend')?.roleId).toBe('role-admin');
    db.tx.user.findUnique.mockImplementation(read);
  });
});

describe('the owner simulating a role in development', () => {
  /** What getEffectiveSession returns while the real owner plays the "Secrétaire" role. */
  function simulatingSecretary(): EffectiveSession {
    const real = db.sessionOf('owner', MODULES);
    const secretary = db.role('role-secretary')!;
    return {
      ...real,
      user: {
        ...real.user,
        ...accessFor({ status: 'MEMBER', roleId: secretary.id, role: secretary }, MODULES),
      },
      isImpersonating: true,
      simulatedAs: 'Secrétaire',
    };
  }

  it('is held to the simulated role’s limits, so the restrictions can really be tested', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(simulatingSecretary());

    await expectUntouched(async () => {
      await expect(members.changeMemberRole('u_mem', 'role-president')).resolves.toEqual({
        ok: false,
        error: 'cannotGrant',
      });
      await expect(members.changeMemberRole('u_pres', 'role-member')).resolves.toEqual({
        ok: false,
        error: 'cannotManageMember',
      });
      await expect(rolePages.deleteRole('role-spare')).rejects.toThrow('Forbidden'); // no roles.manage
    });
  });

  it('writes under the real login and flags the simulation in the audit entry', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(simulatingSecretary());

    await expect(members.changeMemberRole('u_mem', 'role-secretary')).resolves.toEqual({
      ok: true,
    });

    expect(db.state.audit[0]).toMatchObject({
      actorLogin: 'owner',
      actorId: 'u_owner',
      action: 'member.role_change',
      metadata: { from: 'Membre', to: 'Secrétaire', simulatedAsRole: 'Secrétaire' },
    });
  });
});

describe('no way to become an owner or to reach the audit log through roles', () => {
  it('has no permission for the audit log to give, and no key is accepted for it', async () => {
    actAs('owner');
    for (const key of ['audit.view', 'audit.manage', 'audit-log.view', 'owner']) {
      await expectUntouched(async () => {
        await expect(
          rolePages.createRole({}, roleForm({ name: 'Audit', permissions: [key] })),
        ).resolves.toMatchObject({ fieldErrors: { permissions: 'unknown' } });
      });
    }
  });

  it('never gives the OWNER status through a role change', async () => {
    actAs('adm');
    await expect(members.changeMemberRole('u_mem', 'OWNER')).resolves.toEqual({
      ok: false,
      error: 'roleNotFound',
    });
    expect(db.user('mem')?.status).toBe('MEMBER');
  });
});

describe('member notifications', () => {
  it('announces an approval once it went through, for the member that was approved', async () => {
    actAs('sec');
    await members.approveMember('u_pend', 'role-member');
    expect(notifyMemberApproved).not.toHaveBeenCalled(); // after the response, not before

    await runAfter();
    expect(notifyMemberApproved).toHaveBeenCalledExactlyOnceWith('u_pend', 'sec'); // and who approved
  });

  it('announces nothing when the approval is refused', async () => {
    actAs('sec');
    await members.approveMember('u_pend', 'role-admin'); // above the approver
    await members.approveMember('u_mem', 'role-member'); // not pending

    await runAfter();
    expect(notifyMemberApproved).not.toHaveBeenCalled();
  });

  it('announces a removal with who was removed, once the row is gone', async () => {
    actAs('adm');
    await members.removeMember('u_mem');

    await runAfter();
    expect(notifyMemberRemoved).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ login: 'mem', fullName: 'mem', roleName: 'Membre' }),
      'adm', // who removed them
    );
  });

  it('announces nothing for a removal that is refused', async () => {
    actAs('sec');
    await members.removeMember('u_adm'); // above the actor
    await members.removeMember('u_owner');
    await members.removeMember('u_sec'); // oneself

    await runAfter();
    expect(notifyMemberRemoved).not.toHaveBeenCalled();
  });

  it('does not announce a refusal of a request (nobody asked for that message)', async () => {
    actAs('sec');
    await members.rejectMember('u_pend');

    await runAfter();
    expect(notifyMemberApproved).not.toHaveBeenCalled();
    expect(notifyMemberRemoved).not.toHaveBeenCalled();
  });
});
