import { describe, expect, it } from 'vitest';
import type { UserStatus } from '@/generated/prisma/client';
import type { PermissionSet } from '@/lib/permissions';
import {
  ruleApprove,
  ruleAssignRole,
  ruleDeleteRole,
  ruleGrant,
  ruleManageRole,
  ruleRemove,
  ruleSetDefaultRole,
  ruleUpdateRole,
  type Actor,
  type RoleFacts,
} from './guards';

/**
 * The privilege-escalation rules as plain functions of "what do I hold" and "what am I touching".
 * The same rules are exercised end to end, with real transactions, in escalation.test.ts.
 */

const set = (keys: string[], all = false): PermissionSet => ({ all, keys: new Set(keys) });
const EVERYTHING = [
  'members.manage',
  'roles.manage',
  'events.view',
  'events.manage',
  'events.shared_calendar',
];

function actor(keys: string[], overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'actor',
    login: 'actor',
    status: 'MEMBER',
    roleId: 'role-actor',
    set: set(keys),
    ...overrides,
  };
}

const role = (id: string, keys: string[], all = false): RoleFacts => ({ id, set: set(keys, all) });
const member = (
  roleFacts: RoleFacts | null,
  overrides: { id?: string; status?: UserStatus } = {},
) => ({
  id: 'target',
  status: 'MEMBER' as UserStatus,
  role: roleFacts,
  ...overrides,
});

const owner = actor(EVERYTHING, { status: 'OWNER', roleId: null, set: set(EVERYTHING, true) });
const admin = actor(EVERYTHING, { roleId: 'role-admin', set: set(EVERYTHING, true) });

describe('ruleGrant — nobody grants a permission they do not hold', () => {
  it('accepts a permission set the actor holds, or a subset', () => {
    expect(ruleGrant(actor(['events.view', 'events.manage']), set(['events.view']))).toBeNull();
    expect(ruleGrant(actor(['events.view']), set(['events.view']))).toBeNull();
    expect(ruleGrant(actor(['events.view']), set([]))).toBeNull();
  });

  it('refuses a single permission beyond the actor’s own', () => {
    expect(ruleGrant(actor(['events.view']), set(['events.view', 'members.manage']))).toBe(
      'cannotGrant',
    );
    expect(ruleGrant(actor([]), set(['roles.manage']))).toBe('cannotGrant');
  });

  it('refuses "all permissions" to anyone who does not hold all, even with every permission listed', () => {
    expect(ruleGrant(actor(EVERYTHING), set(EVERYTHING, true))).toBe('cannotGrant');
    expect(ruleGrant(admin, set(EVERYTHING, true))).toBeNull();
    expect(ruleGrant(owner, set(EVERYTHING, true))).toBeNull();
  });
});

describe('ruleManageRole — a role you can edit, delete or flag', () => {
  it('refuses the actor’s own role, whatever it contains', () => {
    expect(
      ruleManageRole(actor(['events.view'], { roleId: 'r1' }), role('r1', ['events.view'])),
    ).toBe('ownRole');
    expect(ruleManageRole(admin, role('role-admin', EVERYTHING, true))).toBe('ownRole');
  });

  it('refuses a role that gives rights the actor lacks (nobody strips a superior)', () => {
    expect(
      ruleManageRole(actor(['members.manage']), role('r2', ['members.manage', 'roles.manage'])),
    ).toBe('cannotManageRole');
    expect(ruleManageRole(actor(EVERYTHING), role('r2', [], true))).toBe('cannotManageRole');
  });

  it('allows a role the actor fully covers, including one with exactly the same rights', () => {
    expect(
      ruleManageRole(actor(['members.manage', 'events.view']), role('r2', ['events.view'])),
    ).toBeNull();
    expect(ruleManageRole(actor(['events.view']), role('r2', ['events.view']))).toBeNull();
  });

  it('lets an owner manage every role (they have no role of their own)', () => {
    expect(ruleManageRole(owner, role('anything', EVERYTHING, true))).toBeNull();
  });
});

describe('ruleUpdateRole', () => {
  const lower = role('r2', ['events.view']);

  it('allows editing a lower role within the actor’s permissions', () => {
    expect(
      ruleUpdateRole(
        actor(['events.view', 'events.manage']),
        lower,
        set(['events.view', 'events.manage']),
      ),
    ).toBeNull();
  });

  it('refuses to add a permission the actor lacks to a role they may edit', () => {
    expect(
      ruleUpdateRole(actor(['events.view']), lower, set(['events.view', 'events.manage'])),
    ).toBe('cannotGrant');
  });

  it('refuses a role the actor may not touch, before looking at the new permissions', () => {
    expect(ruleUpdateRole(actor(['events.view'], { roleId: 'r2' }), lower, set([]))).toBe(
      'ownRole',
    );
    expect(ruleUpdateRole(actor([]), lower, set([]))).toBe('cannotManageRole');
  });
});

describe('ruleDeleteRole', () => {
  const unused = { ...role('r2', ['events.view']), isDefault: false };

  it('allows deleting a role nobody holds that the actor covers', () => {
    expect(ruleDeleteRole(actor(['events.view']), unused, 0)).toBeNull();
  });

  it('refuses a role that is still held, with the number of holders irrelevant beyond one', () => {
    expect(ruleDeleteRole(actor(['events.view']), unused, 1)).toBe('roleInUse');
    expect(ruleDeleteRole(actor(['events.view']), unused, 40)).toBe('roleInUse');
  });

  it('refuses the default role, even unused', () => {
    expect(ruleDeleteRole(actor(['events.view']), { ...unused, isDefault: true }, 0)).toBe(
      'isDefault',
    );
  });

  it('refuses the actor’s own role and a role above them first', () => {
    expect(ruleDeleteRole(actor(['events.view'], { roleId: 'r2' }), unused, 0)).toBe('ownRole');
    expect(ruleDeleteRole(actor([]), unused, 0)).toBe('cannotManageRole');
  });
});

describe('ruleSetDefaultRole', () => {
  it('follows the same rules as editing the role', () => {
    expect(ruleSetDefaultRole(actor(['events.view']), role('r2', ['events.view']))).toBeNull();
    expect(ruleSetDefaultRole(actor([], { roleId: 'r2' }), role('r2', []))).toBe('ownRole');
    expect(ruleSetDefaultRole(actor([]), role('r2', ['events.view']))).toBe('cannotManageRole');
  });
});

describe('ruleAssignRole — giving a member another role', () => {
  const secretary = actor(['members.manage', 'events.view', 'events.manage'], {
    roleId: 'role-secretary',
  });
  const memberRole = role('role-member', ['events.view']);
  const eventsRole = role('role-events', ['events.view', 'events.manage']);
  const presidentRole = role('role-president', EVERYTHING);

  it('moves a member between roles the actor covers', () => {
    expect(ruleAssignRole(secretary, member(memberRole), eventsRole)).toBeNull();
    expect(ruleAssignRole(secretary, member(eventsRole), memberRole)).toBeNull();
  });

  it('never lets anyone change their own role', () => {
    expect(ruleAssignRole(secretary, member(memberRole, { id: 'actor' }), eventsRole)).toBe(
      'targetIsSelf',
    );
    expect(ruleAssignRole(admin, member(memberRole, { id: 'actor' }), memberRole)).toBe(
      'targetIsSelf',
    );
  });

  it('refuses a role the actor does not fully cover (no promotion beyond oneself)', () => {
    expect(ruleAssignRole(secretary, member(memberRole), presidentRole)).toBe('cannotGrant');
    expect(ruleAssignRole(secretary, member(memberRole), role('all', [], true))).toBe(
      'cannotGrant',
    );
  });

  it('refuses to move a member whose current role is above the actor (no demoting a superior)', () => {
    expect(ruleAssignRole(secretary, member(presidentRole), memberRole)).toBe('cannotManageMember');
    expect(ruleAssignRole(secretary, member(role('all', [], true)), memberRole)).toBe(
      'cannotManageMember',
    );
  });

  it("allows moving a colleague who holds exactly the actor's rights", () => {
    const colleague = role('role-secretary-2', ['members.manage', 'events.view', 'events.manage']);
    expect(ruleAssignRole(secretary, member(colleague), memberRole)).toBeNull();
  });

  it('never touches an owner, and never a member without a role or a pending account', () => {
    expect(ruleAssignRole(admin, member(null, { status: 'OWNER' }), memberRole)).toBe(
      'targetIsOwner',
    );
    expect(ruleAssignRole(admin, member(null), memberRole)).toBe('targetNotMember');
    expect(ruleAssignRole(admin, member(null, { status: 'PENDING' }), memberRole)).toBe(
      'targetNotMember',
    );
  });

  it('lets an owner and an admin do what the rights allow', () => {
    expect(ruleAssignRole(owner, member(presidentRole), memberRole)).toBeNull();
    expect(ruleAssignRole(admin, member(presidentRole), role('all', [], true))).toBeNull();
  });
});

describe('ruleApprove', () => {
  const secretary = actor(['members.manage', 'events.view']);

  it('approves a pending account with a role the actor covers', () => {
    expect(
      ruleApprove(secretary, { id: 't', status: 'PENDING' }, role('role-member', ['events.view'])),
    ).toBeNull();
  });

  it('refuses a role above the actor', () => {
    expect(
      ruleApprove(secretary, { id: 't', status: 'PENDING' }, role('r', ['roles.manage'])),
    ).toBe('cannotGrant');
  });

  it('refuses anything that is not a pending account, and oneself', () => {
    expect(ruleApprove(secretary, { id: 't', status: 'MEMBER' }, role('r', []))).toBe(
      'targetNotPending',
    );
    expect(ruleApprove(secretary, { id: 't', status: 'OWNER' }, role('r', []))).toBe(
      'targetNotPending',
    );
    expect(ruleApprove(secretary, { id: 'actor', status: 'PENDING' }, role('r', []))).toBe(
      'targetIsSelf',
    );
  });
});

describe('ruleRemove — refusing a request or removing a member', () => {
  const secretary = actor(['members.manage', 'events.view', 'events.manage']);

  it('removes a member whose role the actor covers, and a pending request', () => {
    expect(ruleRemove(secretary, member(role('r', ['events.view'])))).toBeNull();
    expect(ruleRemove(secretary, member(null, { status: 'PENDING' }))).toBeNull();
  });

  it('refuses a member whose role is above the actor', () => {
    expect(ruleRemove(secretary, member(role('r', EVERYTHING)))).toBe('cannotManageMember');
    expect(ruleRemove(secretary, member(role('all', [], true)))).toBe('cannotManageMember');
  });

  it('refuses a member without a role (inconsistent data) rather than guessing', () => {
    expect(ruleRemove(secretary, member(null))).toBe('cannotManageMember');
  });

  it('never removes an owner, nor oneself', () => {
    expect(ruleRemove(admin, member(null, { status: 'OWNER' }))).toBe('targetIsOwner');
    expect(ruleRemove(admin, member(role('r', []), { id: 'actor' }))).toBe('targetIsSelf');
  });
});
