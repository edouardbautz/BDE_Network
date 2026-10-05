import { describe, expect, it } from 'vitest';
import type { UserStatus } from '@/generated/prisma/client';
import {
  activePermissionKeys,
  APPROVED_STATUSES,
  can,
  canViewAuditLog,
  holdsAllOf,
  isApproved,
  isKnownStatus,
  MEMBERS_MANAGE,
  normalizePermissions,
  permissionDefinitions,
  resolvePermissionSet,
  ROLES_MANAGE,
  unknownPermissionKeys,
  type PermissionSet,
} from './index';

/** What a session carries for an account that was removed, or a corrupted one. */
const NOT_A_STATUS = [undefined, null, '', 'member', 'ADMIN', 'constructor', '__proto__'] as const;
const asStatus = (value: unknown) => value as UserStatus;

const set = (keys: string[], all = false): PermissionSet => ({ all, keys: new Set(keys) });

describe('the permission registry', () => {
  it('has the two core permissions when no module is enabled', () => {
    expect(activePermissionKeys([])).toEqual([MEMBERS_MANAGE, ROLES_MANAGE]);
  });

  it('gives every enabled module view and manage, plus what the module declares', () => {
    expect(activePermissionKeys(['events'])).toEqual([
      'members.manage',
      'roles.manage',
      'events.view',
      'events.manage',
      'events.shared_calendar',
    ]);
  });

  it('works for a module nobody registered (a fork can add its own)', () => {
    expect(activePermissionKeys(['finance'])).toEqual([
      'members.manage',
      'roles.manage',
      'finance.view',
      'finance.manage',
    ]);
  });

  it('lists a module once, and skips a key that cannot be part of a permission key', () => {
    expect(activePermissionKeys(['events', 'events', 'bad.key', 'with space', ''])).toEqual(
      activePermissionKeys(['events']),
    );
  });

  it('groups permissions in sections: core, then one per module', () => {
    const sections = permissionDefinitions(['events', 'finance']).map(
      (definition) => definition.section,
    );
    expect([...new Set(sections)]).toEqual(['core', 'events', 'finance']);
  });

  it('says managing a module includes viewing it', () => {
    const manage = permissionDefinitions(['events']).find((d) => d.key === 'events.manage');
    expect(manage?.implies).toEqual(['events.view']);
  });
});

describe('normalizePermissions', () => {
  const definitions = permissionDefinitions(['events']);

  it('adds what a permission implies, removes duplicates and sorts', () => {
    expect(
      normalizePermissions(['events.manage', 'members.manage', 'events.manage'], definitions),
    ).toEqual(['events.manage', 'events.view', 'members.manage']);
  });

  it('drops keys that do not exist (typos, a disabled module)', () => {
    expect(normalizePermissions(['events.view', 'finance.manage', 'nope'], definitions)).toEqual([
      'events.view',
    ]);
  });

  it('reports the unknown keys so a caller can refuse them', () => {
    expect(
      unknownPermissionKeys(['events.view', 'finance.manage', 'nope', 'nope'], definitions),
    ).toEqual(['finance.manage', 'nope']);
    expect(unknownPermissionKeys(['events.view'], definitions)).toEqual([]);
  });
});

describe('resolvePermissionSet', () => {
  const modules = ['events'];

  it('gives an owner everything, whatever the modules', () => {
    const owner = resolvePermissionSet('OWNER', null, modules);
    expect(owner.all).toBe(true);
    expect([...owner.keys]).toEqual(activePermissionKeys(modules));
  });

  it('gives a member what their role grants, with what it implies', () => {
    const member = resolvePermissionSet(
      'MEMBER',
      { permissions: ['events.manage'], allPermissions: false },
      modules,
    );
    expect(member.all).toBe(false);
    expect([...member.keys].sort()).toEqual(['events.manage', 'events.view']);
  });

  it('gives a role with all permissions every active permission, including a later module', () => {
    const role = { permissions: [], allPermissions: true };
    expect(resolvePermissionSet('MEMBER', role, ['events']).keys.has('events.manage')).toBe(true);
    const later = resolvePermissionSet('MEMBER', role, ['events', 'finance']);
    expect(later.all).toBe(true);
    expect(later.keys.has('finance.manage')).toBe(true);
  });

  it('ignores the permissions of a module that is not enabled, but they are not lost', () => {
    const role = { permissions: ['events.manage', 'finance.manage'], allPermissions: false };
    expect(resolvePermissionSet('MEMBER', role, ['events']).keys.has('finance.manage')).toBe(false);
    expect(
      resolvePermissionSet('MEMBER', role, ['events', 'finance']).keys.has('finance.manage'),
    ).toBe(true);
  });

  it('gives a pending account nothing, even with a role attached', () => {
    const role = { permissions: ['members.manage'], allPermissions: true };
    expect(resolvePermissionSet('PENDING', role, modules)).toEqual({ all: false, keys: new Set() });
  });

  it('gives a member without a role nothing', () => {
    expect(resolvePermissionSet('MEMBER', null, modules)).toEqual({ all: false, keys: new Set() });
  });

  it.each(NOT_A_STATUS)('gives the status %j nothing', (status) => {
    const role = { permissions: ['members.manage'], allPermissions: true };
    expect(resolvePermissionSet(asStatus(status), role, modules).keys.size).toBe(0);
  });
});

describe('holdsAllOf (the rule behind every grant)', () => {
  it('holds a subset, and the same set', () => {
    expect(holdsAllOf(set(['a', 'b']), set(['a']))).toBe(true);
    expect(holdsAllOf(set(['a', 'b']), set(['a', 'b']))).toBe(true);
    expect(holdsAllOf(set(['a']), set([]))).toBe(true);
  });

  it('does not hold a permission it lacks', () => {
    expect(holdsAllOf(set(['a']), set(['a', 'b']))).toBe(false);
    expect(holdsAllOf(set([]), set(['a']))).toBe(false);
  });

  it('is covered by someone who holds all', () => {
    expect(holdsAllOf(set([], true), set(['a', 'b']))).toBe(true);
    expect(holdsAllOf(set([], true), set(['a'], true))).toBe(true);
  });

  // A role with all permissions grows with every module added later: a member whose
  // role merely lists today's permissions would not hold it.
  it('does not let an explicit list cover a role with all permissions', () => {
    expect(holdsAllOf(set(['a', 'b']), set(['a', 'b'], true))).toBe(false);
  });
});

describe('can', () => {
  const member = { status: 'MEMBER' as const, permissions: ['events.view'] };

  it('is true only for a permission held', () => {
    expect(can(member, 'events.view')).toBe(true);
    expect(can(member, 'events.manage')).toBe(false);
    expect(can(member, 'nope')).toBe(false);
  });

  it('is false without an account, or with broken data', () => {
    expect(can(null, 'events.view')).toBe(false);
    expect(can(undefined, 'events.view')).toBe(false);
    expect(
      can({ status: 'MEMBER', permissions: undefined as unknown as string[] }, 'events.view'),
    ).toBe(false);
    expect(can(member, undefined as unknown as string)).toBe(false);
  });

  it('is false for a pending account, even if permissions were attached by mistake', () => {
    expect(can({ status: 'PENDING', permissions: ['events.view'] }, 'events.view')).toBe(false);
  });

  it.each(NOT_A_STATUS)('is false for the status %j', (status) => {
    expect(can({ status: asStatus(status), permissions: ['events.view'] }, 'events.view')).toBe(
      false,
    );
  });
});

describe('statuses', () => {
  it('lists exactly the statuses that can use the app', () => {
    expect([...APPROVED_STATUSES].sort()).toEqual(['MEMBER', 'OWNER']);
  });

  it.each(NOT_A_STATUS)('does not count %j as approved or known', (value) => {
    expect(isApproved(asStatus(value))).toBe(false);
    expect(isKnownStatus(value)).toBe(false);
  });

  it.each(['OWNER', 'MEMBER', 'PENDING'])('knows %s', (status) => {
    expect(isKnownStatus(status)).toBe(true);
  });

  it('approves owners and members, not pending accounts', () => {
    expect(isApproved('OWNER')).toBe(true);
    expect(isApproved('MEMBER')).toBe(true);
    expect(isApproved('PENDING')).toBe(false);
  });
});

describe('the audit log', () => {
  it('is for the owner only, whatever roles exist', () => {
    expect(canViewAuditLog({ status: 'OWNER' })).toBe(true);
    expect(canViewAuditLog({ status: 'MEMBER' })).toBe(false);
    expect(canViewAuditLog({ status: 'PENDING' })).toBe(false);
    expect(canViewAuditLog(null)).toBe(false);
    expect(canViewAuditLog({ status: asStatus('OWNERS') })).toBe(false);
  });
});
