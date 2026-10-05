'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import {
  DEV_IMPERSONATION_COOKIE,
  isDevImpersonationEnabled,
  isImpersonatableRole,
} from './dev-impersonation';

/** Only the real (never simulated) OWNER may switch roles — checked against
 * a fresh `auth()` call, not a cookie, so it can't be spoofed by whatever
 * this module itself writes. */
async function requireRealOwner(): Promise<void> {
  if (!isDevImpersonationEnabled()) {
    throw new Error('Dev impersonation is disabled');
  }

  const session = await auth();
  if (!session?.user || session.user.role !== 'OWNER') {
    throw new Error('Forbidden');
  }
}

export async function startImpersonation(role: string): Promise<void> {
  await requireRealOwner();

  if (!isImpersonatableRole(role)) {
    throw new Error('Invalid role');
  }

  const store = await cookies();
  store.set(DEV_IMPERSONATION_COOKIE, role, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}

export async function stopImpersonation(): Promise<void> {
  await requireRealOwner();

  const store = await cookies();
  store.delete(DEV_IMPERSONATION_COOKIE);
  revalidatePath('/', 'layout');
}
