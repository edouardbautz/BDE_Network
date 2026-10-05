import { cookies } from 'next/headers';

export const DEV_IMPERSONATION_COOKIE = 'dev-impersonation-role';

const ROLE_PREFIX = 'role:';
const ROLE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What the real OWNER is pretending to be: an account waiting for approval, or a member with a given role. */
export type Impersonation = { kind: 'pending' } | { kind: 'role'; roleId: string };

/** Both conditions are mandatory. Outside development, or without the
 * explicit opt-in flag, this always returns false — every other function in
 * this module (and the impersonation banner/actions built on top of it)
 * becomes a no-op, so there is no code path left reachable in production. */
export function isDevImpersonationEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_IMPERSONATION === 'true';
}

/** Parses the value of the cookie and of the banner's menu: "PENDING" or "role:<id>". */
export function parseImpersonation(value: string | undefined | null): Impersonation | null {
  if (value === 'PENDING') {
    return { kind: 'pending' };
  }
  if (typeof value === 'string' && value.startsWith(ROLE_PREFIX)) {
    const roleId = value.slice(ROLE_PREFIX.length);
    return ROLE_ID.test(roleId) ? { kind: 'role', roleId } : null;
  }
  return null;
}

export function serializeImpersonation(impersonation: Impersonation): string {
  return impersonation.kind === 'pending' ? 'PENDING' : `${ROLE_PREFIX}${impersonation.roleId}`;
}

/** The simulation currently active, if any. Always null when
 * impersonation isn't enabled, regardless of what the cookie contains. */
export async function getImpersonation(): Promise<Impersonation | null> {
  if (!isDevImpersonationEnabled()) {
    return null;
  }

  const store = await cookies();
  return parseImpersonation(store.get(DEV_IMPERSONATION_COOKIE)?.value);
}
