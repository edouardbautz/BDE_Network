import type { UserStatus } from '@/generated/prisma/client';
import { resolvePermissionSet, type RoleGrants } from '@/lib/permissions';

/** What the session carries about an account's rights (see types/next-auth.d.ts). */
export interface SessionAccess {
  status: UserStatus;
  roleId: string | null;
  roleName: string | null;
  /** Resolved permissions: the keys of the enabled modules the account holds. */
  permissions: string[];
  /** Holds everything, including what future modules add. */
  holdsAll: boolean;
}

interface AccessSource {
  status: UserStatus;
  roleId: string | null;
  role: (RoleGrants & { name: string }) | null;
}

/**
 * Builds the access part of a session from the database row of an account and its role.
 * A member without a role (which the database refuses to store) gets nothing.
 */
export function accessFor(source: AccessSource, enabledModules: readonly string[]): SessionAccess {
  const set = resolvePermissionSet(source.status, source.role, enabledModules);
  return {
    status: source.status,
    roleId: source.status === 'MEMBER' ? source.roleId : null,
    roleName: source.status === 'MEMBER' ? (source.role?.name ?? null) : null,
    permissions: [...set.keys].sort(),
    holdsAll: set.all,
  };
}
