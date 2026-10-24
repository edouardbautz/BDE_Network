import { ICON as EVENT_ICON, KIND_ICON as EVENT_KIND_ICON } from '@/lib/events/discord-embed';
import { ICON as MEMBER_ICON, KIND_ICON as MEMBER_KIND_ICON } from '@/lib/members/discord-embed';
import { PLATFORM_NAME } from '../platform';
import { getNotificationRaw } from '../translate';
import type { ChannelDefaults, ItemDefault } from './defaults-shape';
import { EVENT_KIND_OF } from './kinds';
import type { TemplateChannel, TemplateType } from './types';

/**
 * What the platform says by itself, as the patterns a template starts from: the words of the catalog with their `{variables}`
 * untouched (the placeholders of the messages are the variables of a template, on purpose). The editor shows them where the BDE
 * has written nothing, and a text equal to its pattern is stored as no text at all, so what was not changed keeps following the
 * platform. `defaults.test.ts` proves that each pattern, with the values of an example, is exactly what the platform sends.
 */

const EVENTS = 'events.notifications';
const MEMBERS = 'members.notifications';

const MEMBER_KIND = {
  memberPending: 'pending',
  memberApproved: 'approved',
  memberRemoved: 'removed',
} as const;

const EVENT_SUBJECT: Record<string, string> = {
  eventConfirmed: 'confirmed.subject',
  eventReminder: 'reminder.subjectPattern',
  eventProposed: 'proposed.subject',
  eventApproved: 'approved.subject',
  eventRefused: 'refused.subject',
  intraRequested: 'intra.intraRequested.subject',
  intraChanged: 'intra.intraChanged.subject',
  intraCancelled: 'intra.intraCancelled.subject',
  intraPublished: 'intra.intraPublished.subject',
  intraRefused: 'intra.intraRefused.subject',
};

/** What the platform says, in the language of the BDE, for a type and a channel. */
export async function describeDefaults(
  type: TemplateType,
  channel: TemplateChannel,
  locale: 'fr' | 'en',
): Promise<ChannelDefaults> {
  const raw = (namespace: string, key: string) => getNotificationRaw(locale, namespace, key);
  const footer =
    channel === 'discord' ? PLATFORM_NAME : channel === 'slack' ? `{bde} · ${PLATFORM_NAME}` : '';

  const eventKind = EVENT_KIND_OF[type];
  const staffType =
    type === 'intraRequested' || type === 'intraChanged' || type === 'intraCancelled';
  if (eventKind) {
    const field = (key: string) => raw(EVENTS, `embed.fields.${key}`);
    const withEmoji = async (key: string, icon: string): Promise<ItemDefault> => ({
      label: await field(key),
      ...(channel === 'discord' && { emoji: icon }),
    });
    const items: ChannelDefaults['items'] = {
      when: await withEmoji('when', EVENT_ICON.when),
      repeats: await withEmoji('repeats', EVENT_ICON.repeats),
      where: await withEmoji('where', EVENT_ICON.where),
      description: {},
      category: await withEmoji('category', EVENT_ICON.category),
      assignees: await withEmoji('inCharge', EVENT_ICON.inCharge),
      proposedBy: await withEmoji('proposedBy', EVENT_ICON.author),
      reviewedBy: await withEmoji(
        type === 'eventApproved' ? 'approvedBy' : 'refusedBy',
        EVENT_ICON.reviewer,
      ),
      reason: await withEmoji('reason', EVENT_ICON.reason),
      requestedBy: await withEmoji('requestedBy', EVENT_ICON.requestedBy),
      changes: await withEmoji('changes', EVENT_ICON.changes),
      intraFields: await withEmoji('intraFields', EVENT_ICON.intraFields),
      intraLink: await withEmoji('intraLink', EVENT_ICON.intraLink),
    };
    if (type === 'intraChanged') {
      items.actedBy = await withEmoji('changedBy', EVENT_ICON.reviewer);
    } else if (type === 'intraCancelled') {
      items.actedBy = await withEmoji('cancelledBy', EVENT_ICON.reviewer);
    } else if (type === 'intraPublished') {
      items.actedBy = await withEmoji('publishedBy', EVENT_ICON.reviewer);
    } else if (type === 'intraRefused') {
      items.actedBy = await withEmoji('refusedBy', EVENT_ICON.reviewer);
    }
    return {
      eyebrow: await raw(
        EVENTS,
        type === 'eventReminder' ? 'embed.kind.reminderPattern' : `embed.kind.${eventKind}`,
      ),
      title: '{title}',
      emoji: channel === 'discord' ? EVENT_KIND_ICON[eventKind] : '',
      footer:
        channel === 'email'
          ? await raw(EVENTS, staffType ? 'email.staffFooter' : 'email.footer')
          : footer,
      button: {
        label: await raw(
          EVENTS,
          staffType
            ? 'slack.staffAction'
            : type === 'eventProposed'
              ? 'slack.reviewAction'
              : 'slack.action',
        ),
        native: channel !== 'discord',
      },
      ...(channel === 'email' && {
        subject: await raw(EVENTS, EVENT_SUBJECT[type]!),
        ...(type === 'eventConfirmed' && { note: await raw(EVENTS, 'email.calendarNote') }),
      }),
      items,
    };
  }

  const kind = MEMBER_KIND[type as keyof typeof MEMBER_KIND];
  const field = (key: string) => raw(MEMBERS, `embed.fields.${key}`);
  const withEmoji = async (key: string, icon: string): Promise<ItemDefault> => ({
    label: await field(key),
    ...(channel === 'discord' && { emoji: icon }),
  });
  const approvedEmail = channel === 'email' && type === 'memberApproved';
  const items: ChannelDefaults['items'] = {
    summary: {
      text: await raw(
        MEMBERS,
        approvedEmail ? 'approved.memberIntro' : `embed.description.${kind}`,
      ),
    },
    login: await withEmoji('login', MEMBER_ICON.login),
    campus: await withEmoji('campus', MEMBER_ICON.campus),
    role: await withEmoji('role', MEMBER_ICON.role),
    actedBy:
      kind === 'removed'
        ? await withEmoji('removedBy', MEMBER_ICON.removedBy)
        : await withEmoji('approvedBy', MEMBER_ICON.approvedBy),
  };
  const buttonKey =
    kind === 'pending'
      ? channel === 'slack'
        ? 'slack.pendingAction'
        : channel === 'email'
          ? 'pending.link'
          : 'embed.action.pending'
      : approvedEmail
        ? 'approved.memberLink'
        : 'embed.action.members';
  return {
    eyebrow: await raw(MEMBERS, `embed.kind.${kind}`),
    title: approvedEmail ? await raw(MEMBERS, 'approved.memberSubject') : '{name}',
    emoji: channel === 'discord' ? MEMBER_KIND_ICON[kind] : '',
    footer:
      channel !== 'email'
        ? footer
        : await raw(
            MEMBERS,
            kind === 'pending' ? 'email.footerApprovers' : 'email.footerRequester',
          ),
    button: {
      label: await raw(MEMBERS, buttonKey),
      native: kind === 'pending' || approvedEmail,
    },
    ...(channel === 'email' && {
      subject: await raw(MEMBERS, approvedEmail ? 'approved.memberSubject' : 'pending.subject'),
    }),
    items,
  };
}
