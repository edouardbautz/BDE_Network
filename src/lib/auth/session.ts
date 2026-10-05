import type { Session } from 'next-auth';
import type { Role } from '@/generated/prisma/client';
import { auth } from '@/lib/auth';
import { getImpersonationCookieRole, isDevImpersonationEnabled } from '@/lib/dev-impersonation';
import { isKnownRole } from '@/lib/permissions';

export interface EffectiveSession {
  /** Same shape as a real NextAuth session user. Every field reflects the
   * real account except `role`, which reflects the simulated role while
   * impersonating. */
  user: Session['user'];
  isImpersonating: boolean;
  /** The real, non-simulated role — always populated, even while
   * impersonating, so callers can tell who is really behind the request. */
  realRole: Role;
}

/** The single place every page, layout and server action should call
 * instead of `auth()` directly for anything permission-related. Applies an
 * active dev role simulation on top of the real session — see
 * src/lib/dev-impersonation.ts for when that's possible at all (dev-only,
 * opt-in, real OWNER only, downgrade-only). Identical to `auth()` in every
 * other case, including in production where it's a pure passthrough.
 *
 * Fails closed: a session that does not carry a real account (id, login and a
 * known role) is no session at all. That is what a still-valid cookie looks
 * like once its account has been removed, and every permission check below
 * this point assumes those three fields are there. */
export async function getEffectiveSession(): Promise<EffectiveSession | null> {
  const session = await auth();
  const user = session?.user;
  if (!user || !user.id || !user.login || !isKnownRole(user.role)) {
    return null;
  }

  const realRole = user.role;

  if (isDevImpersonationEnabled() && realRole === 'OWNER') {
    const impersonatedRole = await getImpersonationCookieRole();
    if (impersonatedRole && impersonatedRole !== realRole) {
      return {
        user: { ...user, role: impersonatedRole },
        isImpersonating: true,
        realRole,
      };
    }
  }

  return { user, isImpersonating: false, realRole };
}

/** Extra audit metadata for an action performed under a simulated role.
 * `actorLogin`/`actorId` always come from the real account; this only flags
 * that the role was simulated. Empty outside dev impersonation. */
export function impersonationAuditFields(actor: EffectiveSession): { simulatedAsRole?: Role } {
  return actor.isImpersonating ? { simulatedAsRole: actor.user.role } : {};
}
