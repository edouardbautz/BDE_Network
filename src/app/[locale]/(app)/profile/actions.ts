'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { getEffectiveSession } from '@/lib/auth/session';
import { logAuditEvent } from '@/lib/audit-log';
import { getEventsAccess } from '@/lib/events/access';
import { regenerateCalendarToken } from '@/lib/events/export';
import { parseMentionIds, type MentionIds, type MentionIdsInput } from '@/lib/members/mention-ids';
import type { MentionPlatform } from '@/lib/mention-ids/required';
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
  errors?: Partial<Record<keyof MentionIdsInput, 'invalid' | 'required'>>;
  /** What was typed, so a form that is refused keeps it. */
  values?: MentionIdsInput;
}

/**
 * The caller's own Discord user id and Slack member id, which the platform uses to mention them in what it posts. **Required for each platform
 * the account is asked for** (`lib/mention-ids/required.ts`: the BDE's own webhooks, and the staff's room for those who hold the right to publish
 * on the intra): a blank or missing one of those is refused, and a platform that is not asked is left alone (nothing is erased that the page did not
 * show). The account is the session's, never the request's, and any signed-in account may call it, one waiting for approval included and one whose
 * session holds nothing until it has given its ids: it is the way out of that state. Audited, with the platforms that changed and never the ids.
 */
export async function saveMentionIds(
  _previous: MentionIdsState,
  formData: FormData,
): Promise<MentionIdsState> {
  const session = await getEffectiveSession();
  if (!session || !session.user.id) {
    throw new Error('Forbidden');
  }

  const text = (name: keyof MentionIdsInput) => String(formData.get(name) ?? '');
  const values: MentionIdsInput = {
    discordUserId: text('discordUserId'),
    slackUserId: text('slackUserId'),
  };
  const parsed = parseMentionIds(values);
  const errors: NonNullable<MentionIdsState['errors']> = {};
  if (!parsed.ok) Object.assign(errors, parsed.errors);

  const asked: Record<MentionPlatform, keyof MentionIdsInput> = {
    discord: 'discordUserId',
    slack: 'slackUserId',
  };
  // A platform that is asked must come with an id: a blank answer, or a field the request left out, is not an answer.
  for (const platform of session.requiredIds) {
    const field = asked[platform];
    if (!errors[field] && values[field].trim() === '') errors[field] = 'required';
  }
  if (Object.keys(errors).length > 0 || !parsed.ok) return { errors, values };

  const data: Partial<MentionIds> = {};
  for (const platform of session.requiredIds) {
    data[asked[platform]] = parsed.data[asked[platform]];
  }
  const changed = session.requiredIds.filter(
    (platform) => (data[asked[platform]] ?? null) !== (session.user[asked[platform]] ?? null),
  );

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data });
    if (changed.length > 0) {
      await logAuditEvent(
        {
          actorLogin: session.user.login,
          actorId: session.user.id,
          action: 'profile.mention_ids',
          targetType: 'User',
          targetId: session.user.id,
          targetLabel: session.user.login,
          metadata: { changed },
        },
        tx,
      );
    }
  });

  return {
    saved: true,
    values: {
      discordUserId: data.discordUserId ?? parsed.data.discordUserId ?? '',
      slackUserId: data.slackUserId ?? parsed.data.slackUserId ?? '',
    },
  };
}
