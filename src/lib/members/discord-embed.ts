import { MEMBER_COLORS } from '@/lib/notifications/colors';
import type { DiscordEmbed, DiscordEmbedField } from '@/lib/notifications/discord-embed';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { httpUrl } from '@/lib/notifications/text';
import type { Translate } from '@/lib/notifications/translate';
import type { MemberFacts } from './messages';

export type MemberCardKind = 'pending' | 'approved' | 'removed';

/**
 * A member notification as a Discord card: a colour per kind (amber for a request waiting, green
 * for an approval, red for a removal), the person's 42 photo as a thumbnail, their login and campus
 * in columns, the role, and who did it. The title links to the members page when the platform
 * knows its address.
 */
export function buildMemberEmbed(
  kind: MemberCardKind,
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
  now: Date = new Date(),
): DiscordEmbed {
  const field = (name: string, value: string | null | undefined): DiscordEmbedField[] =>
    value ? [{ name, value, inline: true }] : [];

  const fields = [
    ...field(t('embed.fields.login'), member.login),
    ...field(t('embed.fields.campus'), member.campus),
    // What the member holds (or held): only once there is a role to speak of.
    ...(kind === 'pending' ? [] : field(t('embed.fields.role'), member.roleName)),
    ...(kind === 'approved' ? field(t('embed.fields.approvedBy'), member.actorName) : []),
    ...(kind === 'removed' ? field(t('embed.fields.removedBy'), member.actorName) : []),
  ];

  const thumbnail = httpUrl(member.photoUrl);

  return {
    title: member.fullName,
    url: httpUrl(membersUrl),
    color: MEMBER_COLORS[kind],
    description: `**${t(`embed.kind.${kind}`)}**\n${t(`embed.description.${kind}`, { name: member.fullName })}`,
    fields,
    ...(thumbnail && { thumbnail: { url: thumbnail } }),
    footer: { text: PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}
