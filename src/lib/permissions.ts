import type { Role } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

const ROLE_RANK: Record<Role, number> = {
  PENDING: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasMinRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Members with an approved account (not PENDING) can use the app. */
export function isApproved(role: Role): boolean {
  return role !== 'PENDING';
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
 * ModulePermission row for that module key. */
export function hasModuleAccess(
  role: Role,
  grantedModuleKeys: string[],
  moduleKey: string,
): boolean {
  return role === 'OWNER' || grantedModuleKeys.includes(moduleKey);
}

export async function getUserModuleKeys(userId: string): Promise<string[]> {
  const permissions = await prisma.modulePermission.findMany({
    where: { userId },
    select: { module: true },
  });
  return permissions.map((permission) => permission.module);
}
