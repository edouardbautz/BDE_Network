'use server';

import { revalidatePath } from 'next/cache';
import { getEventsAccess } from '@/lib/events/access';
import { regenerateCalendarToken } from '@/lib/events/export';

/** Replaces the caller's calendar subscription token. The previous link stops
 * working immediately; the member must re-add the new one in their calendar app.
 * Only available while the events module is enabled and the account is approved. */
export async function regenerateMyCalendarToken(): Promise<void> {
  const access = await getEventsAccess();
  if (!access) {
    throw new Error('Forbidden');
  }

  await regenerateCalendarToken(access.session.user.id);
  revalidatePath('/profile');
}
