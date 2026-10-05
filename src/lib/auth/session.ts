import type { Session } from 'next-auth';
import type { Role } from '@/generated/prisma/client';
import { auth } from '@/lib/auth';
import { getImpersonationCookieRole, isDevImpersonationEnabled } from '@/lib/dev-impersonation';

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
 * other case, including in production where it's a pure passthrough. */
export async function getEffectiveSession(): Promise<EffectiveSession | null> {
  const session = await auth();
  if (!session?.user) {
    return null;
  }

  const realRole = session.user.role;

  if (isDevImpersonationEnabled() && realRole === 'OWNER') {
    const impersonatedRole = await getImpersonationCookieRole();
    if (impersonatedRole && impersonatedRole !== realRole) {
      return {
        user: { ...session.user, role: impersonatedRole },
        isImpersonating: true,
        realRole,
      };
    }
  }

  return { user: session.user, isImpersonating: false, realRole };
}
