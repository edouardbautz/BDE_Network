'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { getEventsAccess } from '@/lib/events/access';
import { regenerateCalendarToken } from '@/lib/events/export';

/** Replaces the caller's calendar subscription token. The previous link stops
 * working immediately; the member must re-add the new one in their calendar app.
 * Only available while the events module is enabled and the account is approved. */
/** Answers the address of the profile page, which the browser loads (see lib/action-target.ts). */
export async function regenerateMyCalendarToken(): Promise<ActionTarget> {
  const access = await getEventsAccess();
  if (!access) {
    throw new Error('Forbidden');
  }

  await regenerateCalendarToken(access.session.user.id);
  revalidatePath('/profile');
  return { href: getPathname({ href: '/profile', locale: await getLocale() }) };
}
