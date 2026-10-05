import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: { modulePermission: { findMany: vi.fn() } } }));

const { prisma } = await import('@/lib/prisma');
const {
  APPROVED_ROLES,
  canManageMembers,
  canViewAuditLog,
  getUserModuleKeys,
  hasMinRole,
  hasModuleAccess,
  isApproved,
  isKnownRole,
} = await import('./permissions');

/** What a session carries once its account was removed, or a corrupted one:
 * not a Role, whatever the type system says. */
const NOT_A_ROLE = [undefined, null, '', 'pending', 'GUEST', 'constructor', '__proto__'] as const;
const asRole = (value: unknown) => value as Role;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasMinRole', () => {
  it('ranks OWNER above ADMIN above MEMBER above PENDING', () => {
    expect(hasMinRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasMinRole('ADMIN', 'OWNER')).toBe(false);
    expect(hasMinRole('MEMBER', 'MEMBER')).toBe(true);
    expect(hasMinRole('PENDING', 'MEMBER')).toBe(false);
  });
});

describe('isApproved', () => {
  it('is false only for PENDING', () => {
    expect(isApproved('PENDING')).toBe(false);
    expect(isApproved('MEMBER')).toBe(true);
    expect(isApproved('ADMIN')).toBe(true);
    expect(isApproved('OWNER')).toBe(true);
  });
});

describe('isApproved fails closed', () => {
  it('lists exactly the roles that can use the app', () => {
    expect([...APPROVED_ROLES].sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);
  });

  it.each(NOT_A_ROLE)('refuses %j: it is not an approved role', (value) => {
    expect(isApproved(asRole(value))).toBe(false);
  });
});

describe('isKnownRole', () => {
  it.each(['OWNER', 'ADMIN', 'MEMBER', 'PENDING'])('accepts %s', (role) => {
    expect(isKnownRole(role)).toBe(true);
  });

  it.each(NOT_A_ROLE)('refuses %j', (value) => {
    expect(isKnownRole(value)).toBe(false);
  });
});

describe('hasMinRole with an unknown role', () => {
  it.each(NOT_A_ROLE)('never reaches any minimum with %j', (value) => {
    expect(hasMinRole(asRole(value), 'PENDING')).toBe(false);
    expect(hasMinRole(asRole(value), 'ADMIN')).toBe(false);
    expect(canManageMembers(asRole(value))).toBe(false);
    expect(canViewAuditLog(asRole(value))).toBe(false);
  });
});

describe('canManageMembers', () => {
  it('allows ADMIN and OWNER only', () => {
    expect(canManageMembers('OWNER')).toBe(true);
    expect(canManageMembers('ADMIN')).toBe(true);
    expect(canManageMembers('MEMBER')).toBe(false);
    expect(canManageMembers('PENDING')).toBe(false);
  });
});

describe('canViewAuditLog', () => {
  it('allows OWNER only', () => {
    expect(canViewAuditLog('OWNER')).toBe(true);
    expect(canViewAuditLog('ADMIN')).toBe(false);
  });
});

describe('hasModuleAccess', () => {
  it('always grants OWNER access, regardless of granted modules', () => {
    expect(hasModuleAccess('OWNER', [], 'finance')).toBe(true);
  });

  it('grants MEMBER/ADMIN access only when the module was explicitly granted', () => {
    expect(hasModuleAccess('ADMIN', ['finance'], 'finance')).toBe(true);
    expect(hasModuleAccess('ADMIN', [], 'finance')).toBe(false);
    expect(hasModuleAccess('MEMBER', ['events'], 'finance')).toBe(false);
  });
});

describe('hasModuleAccess fails closed', () => {
  it.each(NOT_A_ROLE)('refuses %j even when the module key was granted', (value) => {
    expect(hasModuleAccess(asRole(value), ['events'], 'events')).toBe(false);
  });

  it('refuses a PENDING account even with a stale permission row', () => {
    expect(hasModuleAccess('PENDING', ['events'], 'events')).toBe(false);
  });
});

describe('getUserModuleKeys', () => {
  it('returns the keys granted to that user', async () => {
    vi.mocked(prisma.modulePermission.findMany).mockResolvedValue([{ module: 'events' }] as never);

    await expect(getUserModuleKeys('u1')).resolves.toEqual(['events']);
    expect(prisma.modulePermission.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { module: true },
    });
  });

  // Prisma ignores `where: { userId: undefined }` and returns every row, so a
  // missing id must never reach the query.
  it.each([undefined, null, ''])('grants nothing and never queries for the id %j', async (id) => {
    vi.mocked(prisma.modulePermission.findMany).mockResolvedValue([{ module: 'events' }] as never);

    await expect(getUserModuleKeys(id as unknown as string)).resolves.toEqual([]);
    expect(prisma.modulePermission.findMany).not.toHaveBeenCalled();
  });
});
