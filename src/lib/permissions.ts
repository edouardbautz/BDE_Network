import type { Role } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

const ROLE_RANK: Record<Role, number> = {
  PENDING: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** Roles that can use the app. An allow-list on purpose: a role that is
 * missing or unknown (e.g. the session of an account that no longer exists)
 * must never count as approved, which `role !== 'PENDING'` would allow. */
export const APPROVED_ROLES: readonly Role[] = ['MEMBER', 'ADMIN', 'OWNER'];

/** Narrows an arbitrary value to a real `Role`. Anything else — undefined, a
 * string that is not a role — is not one. */
export function isKnownRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.keys(ROLE_RANK).includes(value);
}

export function hasMinRole(role: Role, minimum: Role): boolean {
  return isKnownRole(role) && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Members with an approved account (not PENDING) can use the app. */
export function isApproved(role: Role): boolean {
  return APPROVED_ROLES.includes(role);
}

/** Only OWNER and ADMIN see the member management panel. */
export function canManageMembers(role: Role): boolean {
  return hasMinRole(role, 'ADMIN');
}

/** The audit log is OWNER-only, read-only, per spec. */
export function canViewAuditLog(role: Role): boolean {
  return role === 'OWNER';
}

/** Only OWNER and ADMIN grant/revoke module permissions. */
export function canManageModulePermissions(role: Role): boolean {
  return hasMinRole(role, 'ADMIN');
}

/** OWNER always has access to every module; everyone else needs an explicit
 * ModulePermission row for that module key. Never for an account that is not
 * approved, whatever rows it may have. */
export function hasModuleAccess(
  role: Role,
  grantedModuleKeys: string[],
  moduleKey: string,
): boolean {
  return isApproved(role) && (role === 'OWNER' || grantedModuleKeys.includes(moduleKey));
}

/** The module keys granted to one user. Without a real id there is nobody to
 * look up, so nothing is granted: Prisma drops a filter whose value is
 * `undefined`, which would otherwise return *everyone's* permissions. */
export async function getUserModuleKeys(userId: string): Promise<string[]> {
  if (typeof userId !== 'string' || userId.length === 0) {
    return [];
  }

  const permissions = await prisma.modulePermission.findMany({
    where: { userId },
    select: { module: true },
  });
  return permissions.map((permission) => permission.module);
}
