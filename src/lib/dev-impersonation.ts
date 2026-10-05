import { cookies } from 'next/headers';
import type { Role } from '@/generated/prisma/client';

export const DEV_IMPERSONATION_COOKIE = 'dev-impersonation-role';

const IMPERSONATABLE_ROLES: readonly Role[] = ['PENDING', 'MEMBER', 'ADMIN'];

/** Both conditions are mandatory. Outside development, or without the
 * explicit opt-in flag, this always returns false — every other function in
 * this module (and the impersonation banner/actions built on top of it)
 * becomes a no-op, so there is no code path left reachable in production. */
export function isDevImpersonationEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_IMPERSONATION === 'true';
}

export function isImpersonatableRole(value: string | undefined | null): value is Role {
  return IMPERSONATABLE_ROLES.includes(value as Role);
}

/** The role currently being simulated, if any. Always null when
 * impersonation isn't enabled, regardless of what the cookie contains. */
export async function getImpersonationCookieRole(): Promise<Role | null> {
  if (!isDevImpersonationEnabled()) {
    return null;
  }

  const store = await cookies();
  const value = store.get(DEV_IMPERSONATION_COOKIE)?.value;
  return isImpersonatableRole(value) ? value : null;
}
