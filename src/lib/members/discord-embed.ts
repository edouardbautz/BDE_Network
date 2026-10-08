import { MEMBER_COLORS } from '@/lib/notifications/colors';
import {
  BLANK_LINE,
  headingLine,
  kindLine,
  oneLine,
  quoteBlock,
  type DiscordEmbed,
  type DiscordEmbedField,
} from '@/lib/notifications/discord-embed';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { httpUrl } from '@/lib/notifications/text';
import type { Translate } from '@/lib/notifications/translate';
import type { MemberFacts } from './messages';

export type MemberCardKind = 'pending' | 'approved' | 'removed';

const KIND_ICON: Record<MemberCardKind, string> = { pending: '🙋', approved: '✅', removed: '👋' };
const ICON = {
  login: '🪪',
  campus: '🏫',
  role: '🎭',
  approvedBy: '🤝',
  removedBy: '🚪',
  action: '👉',
};

/**
 * A member notification as a Discord card, laid out like the event cards: the colour of the kind on the
 * bar (amber for a request waiting, green for an approval, red for a removal), the person's name as the
 * title, their 42 login and campus as headings in the description with a line saying what happened, and
 * the secondary facts (the role, who did it) as small fields. A request ends with the link to decide it,
 * when the platform knows its address. The 42 photo is the thumbnail (the BDE's logo stands in without one,
 * see `withDiscordCard`).
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
    // What the member holds (or held): only once there is a role to speak of.
    ...(kind === 'pending'
      ? []
      : field(`${ICON.role}  ${t('embed.fields.role')}`, member.roleName)),
    ...(kind === 'approved'
      ? field(`${ICON.approvedBy}  ${t('embed.fields.approvedBy')}`, member.actorName)
      : []),
    ...(kind === 'removed'
      ? field(`${ICON.removedBy}  ${t('embed.fields.removedBy')}`, member.actorName)
      : []),
  ];

  const lines = [
    kindLine(t(`embed.kind.${kind}`)),
    BLANK_LINE,
    headingLine(ICON.login, member.login),
  ];
  if (member.campus) lines.push(`${ICON.campus}  ${oneLine(member.campus)}`);
  lines.push(BLANK_LINE, quoteBlock(t(`embed.description.${kind}`, { name: member.fullName })));

  const link = httpUrl(membersUrl);
  if (kind === 'pending' && link) {
    // A closing parenthesis would end the link early.
    lines.push(
      BLANK_LINE,
      `${ICON.action}  [${t('embed.action.pending')}](${link.replace(/\)/g, '%29')})`,
    );
  }
  if (fields.length > 0) lines.push(BLANK_LINE); // air between the text and the fields

  const thumbnail = httpUrl(member.photoUrl);

  return {
    title: `${KIND_ICON[kind]}  ${member.fullName}`,
    url: link,
    color: MEMBER_COLORS[kind],
    description: lines.join('\n'),
    ...(fields.length > 0 && { fields }),
    ...(thumbnail && { thumbnail: { url: thumbnail } }),
    footer: { text: PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}
