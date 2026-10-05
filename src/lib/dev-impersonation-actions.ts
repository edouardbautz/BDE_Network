'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  DEV_IMPERSONATION_COOKIE,
  isDevImpersonationEnabled,
  parseImpersonation,
} from './dev-impersonation';

/** Only the real (never simulated) OWNER may switch roles — checked against
 * a fresh `auth()` call, not a cookie, so it can't be spoofed by whatever
 * this module itself writes. */
async function requireRealOwner(): Promise<void> {
  if (!isDevImpersonationEnabled()) {
    throw new Error('Dev impersonation is disabled');
  }

  const session = await auth();
  if (!session?.user || session.user.status !== 'OWNER') {
    throw new Error('Forbidden');
  }
}

/** `choice` is "PENDING" or "role:<id>" of an existing role. */
export async function startImpersonation(choice: string): Promise<void> {
  await requireRealOwner();

  const impersonation = parseImpersonation(choice);
  if (!impersonation) {
    throw new Error('Invalid role');
  }
  if (impersonation.kind === 'role') {
    const role = await prisma.role.findUnique({
      where: { id: impersonation.roleId },
      select: { id: true },
    });
    if (!role) {
      throw new Error('Invalid role');
    }
  }

  const store = await cookies();
  store.set(DEV_IMPERSONATION_COOKIE, choice, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}

export async function stopImpersonation(): Promise<void> {
  await requireRealOwner();

  const store = await cookies();
  store.delete(DEV_IMPERSONATION_COOKIE);
  revalidatePath('/', 'layout');
}
