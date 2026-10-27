import { describeFacts } from '@/lib/backups/notifications/facts';
import { buildBackupEmail } from '@/lib/backups/notifications/email';
import { buildBackupEmbed } from '@/lib/backups/notifications/discord-embed';
import { buildBackupSlack } from '@/lib/backups/notifications/slack-blocks';
import { backupAbove } from '@/lib/backups/notifications/template-values';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { eventAbove } from '@/lib/events/template-values';
import { buildMemberEmbed } from '@/lib/members/discord-embed';
import { buildApprovedEmail, buildPendingEmail } from '@/lib/members/email';
import { buildMemberSlack } from '@/lib/members/slack-blocks';
import { memberAbove } from '@/lib/members/template-values';
import { signCard } from '../discord-card';
import { fitEmbed, type DiscordEmbed } from '../discord-embed';
import type { EmailModel } from '../email-layout';
import { neutralizeEmbedForDiscord } from '../sanitize';
import { fitSlackPayload, type SlackPayload } from '../slack-blocks';
import { getNotificationTranslate } from '../translate';
import type { EmailContent } from '../types';
import { channelsOfType } from './catalog';
import { EVENT_KIND_OF } from './kinds';
import type { MentionDirectory, RenderedAbove, StaffMentionIds } from './mentions';
import { sampleBackup, sampleEvent, sampleMember } from './samples';
import type { TemplateChannel, TemplateContent, TemplateType } from './types';

/**
 * A notification drawn with an example, for one channel, **by the code that draws the real one**: the editor's preview, the test
 * message, and the trial a template goes through before it is saved. What comes out is what the adapter would post (the
 * texts made harmless, the limits kept), not a second drawing that could differ.
 */

export interface PreviewOptions {
  locale: 'fr' | 'en';
  timeZone: string;
  /** The name of the BDE, for `{bde}` and the signature. */
  bdeName: string;
  /** The colour of the BDE: the button of an e-mail. */
  accent: string;
  /** The BDE's logo, when the channel can show it. */
  logoUrl?: string;
  /** The platform's address, so that there is a button to show. */
  appUrl?: string | null;
  mentions?: MentionDirectory;
  /** Who `{@staff}` stands for in a message to the staff: an example in the editor, the real people in a test that pings. */
  staff?: StaffMentionIds;
  now?: Date;
}

export type Preview =
  | { channel: 'discord'; embed: DiscordEmbed; above?: RenderedAbove }
  | { channel: 'slack'; message: SlackPayload }
  | { channel: 'email'; mail: EmailContent };

const MEMBER_KIND = {
  memberPending: 'pending',
  memberApproved: 'approved',
  memberRemoved: 'removed',
} as const;

/** The notification of a type for a channel, drawn with the example, with the template applied (none: the platform's own). */
export async function renderPreview(
  type: TemplateType,
  channel: TemplateChannel,
  template: TemplateContent | undefined,
  options: PreviewOptions,
): Promise<Preview> {
  if (!channelsOfType(type).includes(channel)) {
    throw new Error(`${type} is not sent on ${channel}`);
  }
  const { locale, timeZone, bdeName } = options;
  const now = options.now ?? new Date();
  const brand: EmailModel['brand'] = {
    name: bdeName,
    accent: options.accent,
    ...(options.logoUrl && { logoUrl: options.logoUrl }),
  };
  const context = {
    ...(template && { template }),
    bdeName,
    locale,
    mentions: options.mentions,
    ...(options.staff && { staff: options.staff }),
  };
  const sender = { username: bdeName, avatarUrl: options.logoUrl };
  const link = (path: string) => (options.appUrl ? `${options.appUrl}/${locale}${path}` : null);

  const eventKind = EVENT_KIND_OF[type];
  if (eventKind) {
    const t = await getNotificationTranslate(locale, 'events.notifications');
    const data = {
      ...sampleEvent(locale, now, type, t, timeZone),
      url: link(type.startsWith('intra') ? '/events/intra' : '/events/sample'),
    };
    if (channel === 'discord') {
      const embed = signCard(buildEventEmbed(eventKind, data, t, timeZone, now, context), sender);
      return {
        channel,
        embed: fitEmbed(neutralizeEmbedForDiscord(embed)),
        above: eventAbove('discord', eventKind, data, t, locale, timeZone, context),
      };
    }
    if (channel === 'slack') {
      const message = buildEventSlack(eventKind, data, t, locale, timeZone, brand, context);
      return { channel, message: fitSlackPayload(message) };
    }
    return {
      channel,
      mail: buildEventEmail(eventKind, data, t, locale, timeZone, brand, undefined, context),
    };
  }

  if (type === 'backupFailed' || type === 'backupStale') {
    const backupKind = type === 'backupFailed' ? 'failed' : 'stale';
    const t = await getNotificationTranslate(locale, 'backups.notifications');
    const reasons = await getNotificationTranslate(locale, 'settings.backups.reasons');
    const facts = describeFacts(sampleBackup(now), { locale, timeZone, t, reasons });
    const settingsUrl = link('/settings');
    if (channel === 'discord') {
      const embed = signCard(
        buildBackupEmbed(backupKind, facts, t, settingsUrl, now, context),
        sender,
      );
      return {
        channel,
        embed: fitEmbed(neutralizeEmbedForDiscord(embed)),
        above: backupAbove('discord', facts, settingsUrl, context),
      };
    }
    if (channel === 'slack') {
      const message = buildBackupSlack(backupKind, facts, t, settingsUrl, brand, context);
      return { channel, message: fitSlackPayload(message) };
    }
    return {
      channel,
      mail: buildBackupEmail(backupKind, facts, t, settingsUrl, brand, locale, context),
    };
  }

  const kind = MEMBER_KIND[type as keyof typeof MEMBER_KIND];
  const t = await getNotificationTranslate(locale, 'members.notifications');
  const member = sampleMember(locale);
  const membersUrl = link('/members');
  if (channel === 'discord') {
    const embed = signCard(buildMemberEmbed(kind, member, t, membersUrl, now, context), sender);
    return {
      channel,
      embed: fitEmbed(neutralizeEmbedForDiscord(embed)),
      above: memberAbove('discord', member, membersUrl, context),
    };
  }
  if (channel === 'slack') {
    const message = buildMemberSlack(kind, member, t, membersUrl, brand, context);
    return { channel, message: fitSlackPayload(message) };
  }
  if (type === 'memberApproved') {
    return {
      channel,
      mail: buildApprovedEmail(member, member.roleName ?? '', t, link(''), brand, locale, context),
    };
  }
  return {
    channel,
    mail: buildPendingEmail(member, t, membersUrl, brand, locale, context),
  };
}
