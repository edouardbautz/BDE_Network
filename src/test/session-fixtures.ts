import type { Session } from 'next-auth';
import type { UserStatus } from '@/generated/prisma/client';
import type { EffectiveSession } from '@/lib/auth/session';
import {
  activePermissionKeys,
  normalizePermissions,
  permissionDefinitions,
} from '@/lib/permissions';

/**
 * Sessions as the app builds them (see lib/auth/access.ts), for tests. The kinds mirror the
 * accounts of a fresh install:
 * - OWNER: from bde.config.yml, holds everything;
 * - ADMIN: a member with the default "Admin" role (all permissions);
 * - MEMBER: a member with the default "Membre" role (can see the events);
 * - PENDING: waiting for approval, holds nothing.
 * `memberWith` gives a member holding exactly the permissions you list.
 */

export type AccountKind = 'OWNER' | 'ADMIN' | 'MEMBER' | 'PENDING';

/** The modules the tests run with. */
export const TEST_MODULES = ['events'] as const;
export const ALL_PERMISSIONS = activePermissionKeys(TEST_MODULES);

interface Access {
  status: UserStatus;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  holdsAll: boolean;
}

const ACCESS: Record<AccountKind, Access> = {
  OWNER: {
    status: 'OWNER',
    roleId: null,
    roleName: null,
    permissions: ALL_PERMISSIONS,
    holdsAll: true,
  },
  ADMIN: {
    status: 'MEMBER',
    roleId: 'role-admin',
    roleName: 'Admin',
    permissions: ALL_PERMISSIONS,
    holdsAll: true,
  },
  MEMBER: {
    status: 'MEMBER',
    roleId: 'role-member',
    roleName: 'Membre',
    permissions: ['events.view'],
    holdsAll: false,
  },
  PENDING: { status: 'PENDING', roleId: null, roleName: null, permissions: [], holdsAll: false },
};

function build(access: Access, login: string, id: string): Session {
  return {
    user: {
      id,
      login,
      campus: 'Paris',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      ...access,
    },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

/** A NextAuth session for one kind of account. */
export function sessionFor(kind: AccountKind, login = 'test-login', id = 'actor-1'): Session {
  return build(ACCESS[kind], login, id);
}

/**
 * A member whose role grants `permissions`, with what they imply (as when the session is built:
 * managing the shared calendar includes viewing the events). The audit log needs OWNER.
 */
export function memberWith(permissions: string[], login = 'test-login', id = 'actor-1'): Session {
  return build(
    {
      status: 'MEMBER',
      roleId: 'role-custom',
      roleName: 'Custom',
      permissions: normalizePermissions(permissions, permissionDefinitions(TEST_MODULES)),
      holdsAll: false,
    },
    login,
    id,
  );
}

/** What `getEffectiveSession()` returns for a session. */
export function effective(session: Session): EffectiveSession {
  return {
    user: session.user,
    isImpersonating: false,
    simulatedAs: null,
    realStatus: session.user.status,
  };
}

/** What `getEffectiveSession()` returns for one kind of account. */
export function effectiveFor(
  kind: AccountKind,
  login = 'test-login',
  id = 'actor-1',
): EffectiveSession {
  return effective(sessionFor(kind, login, id));
}
