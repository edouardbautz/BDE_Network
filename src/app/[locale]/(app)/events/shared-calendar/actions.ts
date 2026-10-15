'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { requireSharedCalendarManager } from '@/lib/events/access';
import { auditCalendarFeedAction } from '@/lib/events/audit';
import {
  disableBdeFeed,
  enableBdeFeed,
  getBdeFeedToken,
  regenerateBdeFeed,
} from '@/lib/events/export';

/** Logins are `[a-z0-9-]`; anything else is dropped rather than stored in the audit log. */
const LOGIN_PATTERN = /^[a-z0-9-]{1,64}$/i;

/** These actions are asked on the page they change, so they do not redirect to it (a redirect to the page you are on
 * is the one thing the production router often does not show, measured 14 times in 15): they answer the address
 * to load. See lib/action-target.ts. */
async function backToPage(status: 'enabled' | 'regenerated' | 'disabled'): Promise<ActionTarget> {
  revalidatePath('/events/shared-calendar');
  return {
    href: getPathname({
      href: { pathname: '/events/shared-calendar', query: { status } },
      locale: await getLocale(),
    }),
  };
}

export async function enableSharedCalendar(): Promise<ActionTarget> {
  const access = await requireSharedCalendarManager();

  // Enabling an already active link must not look like (or log as) a change.
  if (!(await getBdeFeedToken())) {
    await enableBdeFeed();
    await auditCalendarFeedAction(access, 'calendar_feed.enable');
  }

  return backToPage('enabled');
}

/** `removedMember` is set when the admin regenerates from the "a member just
 * left" prompt, so the audit log says why. */
export async function regenerateSharedCalendar(removedMember?: string): Promise<ActionTarget> {
  const access = await requireSharedCalendarManager();

  await regenerateBdeFeed();
  await auditCalendarFeedAction(
    access,
    'calendar_feed.regenerate',
    removedMember && LOGIN_PATTERN.test(removedMember)
      ? { reason: 'member_removed', member: removedMember }
      : {},
  );

  return backToPage('regenerated');
}

export async function disableSharedCalendar(): Promise<ActionTarget> {
  const access = await requireSharedCalendarManager();

  if (await getBdeFeedToken()) {
    await disableBdeFeed();
    await auditCalendarFeedAction(access, 'calendar_feed.disable');
  }

  return backToPage('disabled');
}
