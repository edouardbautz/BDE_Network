import type { UserStatus } from '@/generated/prisma/client';
import { activePermissionKeys, normalizePermissions, permissionDefinitions } from './registry';

export * from './registry';

/**
 * Who may do what. An account is OWNER (from bde.config.yml: everything), PENDING
 * (nothing) or MEMBER (exactly what its one role grants). Every check goes through
 * `can()`, on the permissions resolved when the session is built; anything missing or
 * unknown means "no".
 */

/** Statuses that can use the app. An allow-list on purpose: a missing or unknown status
 * (e.g. the session of an account that no longer exists) must never count as approved. */
export const APPROVED_STATUSES: readonly UserStatus[] = ['MEMBER', 'OWNER'];

const STATUSES: readonly UserStatus[] = ['OWNER', 'MEMBER', 'PENDING'];

/** Narrows an arbitrary value to a real `UserStatus`. Anything else is not one. */
export function isKnownStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isApproved(status: UserStatus): boolean {
  return APPROVED_STATUSES.includes(status);
}

/** The permissions an account holds, among those of the enabled modules. */
export interface PermissionSet {
  /** Holds everything, including what future modules add (OWNER, or a role with "all permissions"). */
  all: boolean;
  keys: ReadonlySet<string>;
}

export const NO_PERMISSIONS: PermissionSet = { all: false, keys: new Set() };

/** What a role stores. */
export interface RoleGrants {
  permissions: readonly string[];
  allPermissions: boolean;
}

/**
 * The permissions of an account. OWNER holds everything; a member holds what its role
 * grants, restricted to the enabled modules (the keys of a disabled module are kept in the
 * role but ignored); anything else holds nothing.
 */
export function resolvePermissionSet(
  status: UserStatus,
  role: RoleGrants | null,
  enabledModules: readonly string[],
): PermissionSet {
  const active = activePermissionKeys(enabledModules);

  if (status === 'OWNER') {
    return { all: true, keys: new Set(active) };
  }
  if (status !== 'MEMBER' || !role) {
    return NO_PERMISSIONS;
  }
  if (role.allPermissions) {
    return { all: true, keys: new Set(active) };
  }

  const definitions = permissionDefinitions(enabledModules);
  const granted = new Set(normalizePermissions(role.permissions, definitions));
  return { all: false, keys: new Set(active.filter((key) => granted.has(key))) };
}

/**
 * Whether `holder` holds everything `target` grants — the only condition under which
 * someone may hand out, edit or take away what `target` grants. A role with "all
 * permissions" grows with every module added later, so only a holder of "all" covers it.
 */
export function holdsAllOf(holder: PermissionSet, target: PermissionSet): boolean {
  if (target.all && !holder.all) return false;
  if (holder.all) return true;
  return [...target.keys].every((key) => holder.keys.has(key));
}

/** The part of a session the checks need. */
export interface PermissionHolder {
  status: UserStatus;
  /** Resolved permissions (see {@link resolvePermissionSet}). */
  permissions: readonly string[];
}

/** Whether the account holds this permission. Unknown keys and missing data mean no. */
export function can(holder: PermissionHolder | null | undefined, permission: string): boolean {
  return (
    !!holder &&
    isApproved(holder.status) &&
    typeof permission === 'string' &&
    Array.isArray(holder.permissions) &&
    holder.permissions.includes(permission)
  );
}

/** The audit log is reserved for OWNER, whatever roles exist. */
export function canViewAuditLog(
  holder: Pick<PermissionHolder, 'status'> | null | undefined,
): boolean {
  return holder?.status === 'OWNER';
}

/**
 * The settings of the platform (its name, the 42 application, the owners, the notifications...) are reserved for
 * OWNER, like the audit log and for the same reason: they decide who may do anything at all. Not a permission a
 * role can hold: whoever holds it can make themselves an owner.
 */
export function canManageSettings(
  holder: Pick<PermissionHolder, 'status'> | null | undefined,
): boolean {
  return holder?.status === 'OWNER';
}
