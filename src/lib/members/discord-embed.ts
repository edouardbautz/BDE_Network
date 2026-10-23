import { MEMBER_COLORS, colorToInt } from '@/lib/notifications/colors';
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
import { resolveItems } from '@/lib/notifications/templates/apply';
import { renderPlain, renderSegments, toDiscord } from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import { httpUrl } from '@/lib/notifications/text';
import type { Translate } from '@/lib/notifications/translate';
import type { MemberFacts } from './messages';
import { memberTemplateType, memberValues } from './template-values';

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

/** A name with its emoji in front, two spaces between (Discord's own rhythm); no emoji, no space. */
const named = (emoji: string, label: string) => (emoji ? `${emoji}  ${label}` : label);

/**
 * A member notification as a Discord card, laid out like the event cards: the colour of the kind on the
 * bar (amber for a request waiting, green for an approval, red for a removal), the person's name as the
 * title, their 42 login and campus as headings in the description with a line saying what happened, and
 * the secondary facts (the role, who did it) as small fields. A request ends with the link to decide it,
 * when the platform knows its address. The 42 photo is the thumbnail (the BDE's logo stands in without one,
 * see `withDiscordCard`).
 *
 * `context.template` changes what the BDE wants different (texts, colour, which facts and in which order, the link);
 * without it the card is the one the platform has always sent.
 */
export function buildMemberEmbed(
  kind: MemberCardKind,
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
  now: Date = new Date(),
  context: TemplateContext = {},
): DiscordEmbed {
  const { template } = context;
  const values = memberValues(member, context.bdeName, membersUrl);
  const say = (text: string) => renderPlain(text, values);
  const field = (name: string, value: string | null | undefined): DiscordEmbedField[] =>
    value ? [{ name, value, inline: true }] : [];

  const fields: DiscordEmbedField[] = [];
  const blocks: string[][] = [];
  let afterLogin = false;

  for (const item of resolveItems(template, 'discord', memberTemplateType(kind))) {
    const label = (fallback: string) => say(item.label ?? fallback);
    const emoji = (fallback: string) => item.emoji ?? fallback;
    const wasLogin = afterLogin;
    afterLogin = false;
    switch (item.id) {
      case 'login':
        blocks.push([headingLine(emoji(ICON.login), member.login)]);
        afterLogin = true;
        break;
      case 'campus':
        if (member.campus) {
          const line = named(emoji(ICON.campus), oneLine(member.campus));
          // The campus sits right under the login, in the same block.
          if (wasLogin) blocks[blocks.length - 1]!.push(line);
          else blocks.push([line]);
        }
        break;
      case 'summary': {
        const sentence =
          item.text !== undefined
            ? toDiscord(renderSegments(item.text, values)).trim()
            : t(`embed.description.${kind}`, { name: member.fullName });
        if (sentence) blocks.push([quoteBlock(sentence)]);
        break;
      }
      case 'role':
        // What the member holds (or held): only the types that say who they are now have it (`ITEMS`).
        fields.push(
          ...field(named(emoji(ICON.role), label(t('embed.fields.role'))), member.roleName),
        );
        break;
      case 'actedBy':
        if (kind === 'approved') {
          fields.push(
            ...field(
              named(emoji(ICON.approvedBy), label(t('embed.fields.approvedBy'))),
              member.actorName,
            ),
          );
        }
        if (kind === 'removed') {
          fields.push(
            ...field(
              named(emoji(ICON.removedBy), label(t('embed.fields.removedBy'))),
              member.actorName,
            ),
          );
        }
        break;
      default:
        if (item.custom && item.text) {
          const text = toDiscord(renderSegments(item.text, values)).trim();
          if (text) blocks.push([text]);
        }
    }
  }

  const link = httpUrl(membersUrl);
  if ((template?.button?.enabled ?? kind === 'pending') && link) {
    // A closing parenthesis would end the link early.
    const buttonLabel = say(
      template?.button?.label ??
        t(kind === 'pending' ? 'embed.action.pending' : 'embed.action.members'),
    );
    blocks.push([`${ICON.action}  [${buttonLabel}](${link.replace(/\)/g, '%29')})`]);
  }

  const lines: string[] = [kindLine(say(template?.eyebrow ?? t(`embed.kind.${kind}`))), BLANK_LINE];
  blocks.forEach((block, index) => {
    if (index > 0) lines.push(BLANK_LINE);
    lines.push(...block);
  });
  if (fields.length > 0) lines.push(BLANK_LINE); // air between the text and the fields

  const thumbnail = httpUrl(member.photoUrl);

  return {
    title: named(template?.emoji ?? KIND_ICON[kind], say(template?.title ?? '{name}')),
    url: link,
    color: template?.color ? colorToInt(template.color) : MEMBER_COLORS[kind],
    description: lines.join('\n'),
    ...(fields.length > 0 && { fields }),
    ...(thumbnail && { thumbnail: { url: thumbnail } }),
    footer: { text: template?.footer !== undefined ? say(template.footer) : PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}
