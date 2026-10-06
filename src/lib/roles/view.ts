import type { EffectiveSession } from '@/lib/auth/session';
import {
  resolvePermissionSet,
  type PermissionDefinition,
  type RoleGrants,
} from '@/lib/permissions';
import type { Actor, RoleFacts } from './guards';

/**
 * What the pages need to *show* the right choices: which roles the person looking can edit or
 * hand out, which controls to grey out. It reuses the very rules of guards.ts, but it is only
 * display — every action checks again on the server, from the database.
 */

/** The person looking, from their session. */
export function actorOf(user: EffectiveSession['user']): Actor {
  return {
    id: user.id,
    login: user.login,
    status: user.status,
    roleId: user.roleId,
    set: { all: user.holdsAll, keys: new Set(user.permissions) },
  };
}

export function roleFacts(
  role: RoleGrants & { id: string },
  enabledModules: readonly string[],
): RoleFacts {
  return { id: role.id, set: resolvePermissionSet('MEMBER', role, enabledModules) };
}

/** Which permissions a role stores that are offered today (those of a disabled module stay hidden). */
export function visiblePermissions(
  role: { permissions: readonly string[] },
  definitions: readonly PermissionDefinition[],
): string[] {
  const known = new Set(definitions.map((definition) => definition.key));
  return role.permissions.filter((key) => known.has(key));
}
