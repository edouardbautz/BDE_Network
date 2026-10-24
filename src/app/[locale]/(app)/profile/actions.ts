'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { getEffectiveSession } from '@/lib/auth/session';
import { getEventsAccess, isEventsModuleEnabled } from '@/lib/events/access';
import { intraPublicationEnabled } from '@/lib/events/intra-config';
import { regenerateCalendarToken } from '@/lib/events/export';
import { parseMentionIds, type MentionIdsInput } from '@/lib/members/mention-ids';
import { isApproved } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

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

export interface MentionIdsState {
  /** The ids were saved (or removed). */
  saved?: boolean;
  errors?: Partial<Record<keyof MentionIdsInput, 'invalid'>>;
  /** What was typed, so a form that is refused keeps it. */
  values?: MentionIdsInput;
}

/**
 * The caller's own Discord user id and Slack member id, which the platform uses to mention them in the messages it posts for
 * the school's staff (blank removes one). Only for an approved account, and only while the platform publishes on the intra:
 * anything else is a crafted request. The account is the session's, never read from the request. The form keeps its own
 * state, the page shows nothing else of it.
 */
export async function saveMentionIds(
  _previous: MentionIdsState,
  formData: FormData,
): Promise<MentionIdsState> {
  const session = await getEffectiveSession();
  if (
    !session ||
    !session.user.id ||
    !isApproved(session.user.status) ||
    !isEventsModuleEnabled() ||
    !intraPublicationEnabled()
  ) {
    throw new Error('Forbidden');
  }

  const text = (name: keyof MentionIdsInput) => String(formData.get(name) ?? '');
  const values: MentionIdsInput = {
    discordUserId: text('discordUserId'),
    slackUserId: text('slackUserId'),
  };
  const parsed = parseMentionIds(values);
  if (!parsed.ok) return { errors: parsed.errors, values };

  await prisma.user.update({ where: { id: session.user.id }, data: parsed.data });
  return {
    saved: true,
    values: {
      discordUserId: parsed.data.discordUserId ?? '',
      slackUserId: parsed.data.slackUserId ?? '',
    },
  };
}
