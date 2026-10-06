import { cache } from 'react';
import type { Session } from 'next-auth';
import { getConfig } from '@/config';
import type { UserStatus } from '@/generated/prisma/client';
import { auth } from '@/lib/auth';
import { getImpersonation, isDevImpersonationEnabled } from '@/lib/dev-impersonation';
import { isKnownStatus } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { accessFor } from './access';

export interface EffectiveSession {
  /** Same shape as a real NextAuth session user. Every field reflects the
   * real account except the access fields (`status`, role, permissions),
   * which reflect the simulated role while impersonating. */
  user: Session['user'];
  isImpersonating: boolean;
  /** What is being simulated ("PENDING" or a role name); null otherwise. */
  simulatedAs: string | null;
  /** The real, non-simulated status — always populated, even while
   * impersonating, so callers can tell who is really behind the request. */
  realStatus: UserStatus;
}

/** A session that carries a real account: an id, a login, a known status, resolved
 * permissions, and a role when the account is a member. */
function isCompleteSession(user: Session['user'] | undefined): user is Session['user'] {
  return (
    !!user &&
    !!user.id &&
    !!user.login &&
    isKnownStatus(user.status) &&
    Array.isArray(user.permissions) &&
    (user.status !== 'MEMBER' || !!user.roleId)
  );
}

/** The single place every page, layout and server action should call
 * instead of `auth()` directly for anything permission-related. Applies an
 * active dev role simulation on top of the real session — see
 * src/lib/dev-impersonation.ts for when that's possible at all (dev-only,
 * opt-in, real OWNER only, downgrade-only). Identical to `auth()` in every
 * other case, including in production where it's a pure passthrough.
 *
 * Fails closed: a session that does not carry a real account is no session at
 * all. That is what a still-valid cookie looks like once its account has been
 * removed, and every permission check below this point assumes those fields
 * are there. */
async function resolveEffectiveSession(): Promise<EffectiveSession | null> {
  const session = await auth();
  const user = session?.user;
  if (!isCompleteSession(user)) {
    return null;
  }

  const realStatus = user.status;

  if (isDevImpersonationEnabled() && realStatus === 'OWNER') {
    const impersonation = await getImpersonation();

    if (impersonation?.kind === 'pending') {
      return {
        user: { ...user, ...accessFor({ status: 'PENDING', roleId: null, role: null }, []) },
        isImpersonating: true,
        simulatedAs: 'PENDING',
        realStatus,
      };
    }

    if (impersonation?.kind === 'role') {
      const role = await prisma.role.findUnique({ where: { id: impersonation.roleId } });
      if (role) {
        const access = accessFor(
          { status: 'MEMBER', roleId: role.id, role },
          getConfig().modules.enabled,
        );
        return {
          user: { ...user, ...access },
          isImpersonating: true,
          simulatedAs: role.name,
          realStatus,
        };
      }
    }
  }

  return { user, isImpersonating: false, simulatedAs: null, realStatus };
}

/**
 * The session of the current request, resolved once: the layout, the page and every access check
 * of one render all call this, and each `auth()` replays the `jwt` and `session` callbacks
 * (three SQL queries: does the account exist, then its row and its role). `React.cache` makes it
 * once per request, including the check that a removed member is signed out (B1).
 *
 * Request-scoped, never shared between requests: nothing a later request does (a role change, a
 * removal) is hidden by it. Outside a React server render (tests) it is a plain call.
 */
export const getEffectiveSession = cache(resolveEffectiveSession);
