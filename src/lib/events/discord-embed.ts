import { colorToInt } from '@/lib/notifications/colors';
import {
  BLANK_LINE,
  discordTime,
  headingLine,
  kindLine,
  quoteBlock,
  type DiscordEmbed,
} from '@/lib/notifications/discord-embed';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { resolveItems } from '@/lib/notifications/templates/apply';
import { renderPlain, renderSegments, toDiscord } from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import { httpUrl, truncate } from '@/lib/notifications/text';
import { KIND_LABEL_KEY, actionLabelKey, type EventCardKind } from './card-kind';
import type { NotificationEventData, Translate } from './messages';
import { eventValues, templateTypeOf } from './template-values';
import { toLocalDateTime } from './time';

/** How much of the event's description a card shows: it is a notice, the page has the rest. */
const DESCRIPTION_PREVIEW = 350;

/** One icon in front of the title of each kind of card, and of each line of facts. */
export const KIND_ICON: Record<EventCardKind, string> = {
  confirmed: '🎉',
  tomorrow: '⏰',
  today: '🔔',
  proposed: '📝',
  approved: '✅',
  refused: '⛔',
  test: '🧪',
};
export const ICON = {
  when: '📅',
  where: '📍',
  category: '🏷️',
  inCharge: '👥',
  repeats: '🔁',
  author: '👤',
  reviewer: '🛡️',
  reason: '💬',
  button: '👉',
} as const;

/** "15:00 → 18:00 · in 2 days", the end as a full date when the event ends another day. */
function timeLine(data: NotificationEventData, timeZone: string): string {
  const start = toLocalDateTime(data.start, timeZone);
  const end = toLocalDateTime(data.end, timeZone);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;

  const range = `${discordTime(data.start, 't')} → ${discordTime(data.end, sameDay ? 't' : 'F')}`;
  // The countdown moves by itself ("in 2 days") without the message being edited.
  return `${range}  ·  ${discordTime(data.start, 'R')}`;
}

/** A name with its emoji in front, two spaces between (Discord's own rhythm); no emoji, no space. */
const named = (emoji: string, label: string) => (emoji ? `${emoji}  ${label}` : label);

/**
 * The event as a Discord card. The essentials (what, when, where) are large headings in the description,
 * each with its icon and a blank line between them, the description of the event as a quote under them;
 * the secondary facts (category, people in charge, repetition) are small fields underneath. The category's
 * colour is on the bar, the title links to the event, the dates are in Discord's own markup. `now` stamps
 * the footer. The BDE's name and logo are added around it by `withDiscordCard`.
 *
 * `context.template` changes what the BDE wants different (texts, colour, which facts and in which order, a link at the
 * end); without it the card is the one the platform has always sent.
 */
export function buildEventEmbed(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  timeZone: string,
  now: Date = new Date(),
  context: TemplateContext = {},
): DiscordEmbed {
  const { template } = context;
  const values = eventValues(kind, data, t, context.locale ?? 'en', timeZone, context.bdeName);
  const say = (text: string) => renderPlain(text, values);
  const description = data.description?.trim();

  const fields: NonNullable<DiscordEmbed['fields']> = [];
  const blocks: string[][] = [];

  for (const item of resolveItems(template, 'discord', templateTypeOf(kind))) {
    const label = (fallback: string) => say(item.label ?? fallback);
    const emoji = (fallback: string) => item.emoji ?? fallback;
    switch (item.id) {
      case 'reason':
        // The reason of a refusal comes first: it is what the author opens the card for.
        if (kind === 'refused' && data.review?.comment) {
          blocks.push([
            headingLine(emoji(ICON.reason), label(t('embed.fields.reason'))),
            quoteBlock(data.review.comment),
          ]);
        }
        break;
      case 'when':
        blocks.push([
          headingLine(emoji(ICON.when), discordTime(data.start, 'F')),
          timeLine(data, timeZone),
        ]);
        break;
      case 'where':
        if (data.location) blocks.push([headingLine(emoji(ICON.where), data.location)]);
        break;
      case 'description':
        if (description) blocks.push([quoteBlock(truncate(description, DESCRIPTION_PREVIEW))]);
        break;
      case 'category':
        fields.push({
          name: named(emoji(ICON.category), label(t('embed.fields.category'))),
          value: data.categoryLabel,
          inline: true,
        });
        break;
      case 'proposedBy':
        // A chat channel reaches the whole team, not only the person concerned: the card says who it is about.
        if (data.review) {
          fields.push({
            name: named(emoji(ICON.author), label(t('embed.fields.proposedBy'))),
            value: data.review.authorName,
            inline: true,
          });
        }
        break;
      case 'reviewedBy':
        if (data.review?.reviewerName) {
          fields.push({
            name: named(
              emoji(ICON.reviewer),
              label(t(kind === 'approved' ? 'embed.fields.approvedBy' : 'embed.fields.refusedBy')),
            ),
            value: data.review.reviewerName,
            inline: true,
          });
        }
        break;
      case 'assignees':
        if (data.assigneeNames.length > 0) {
          fields.push({
            name: named(emoji(ICON.inCharge), label(t('embed.fields.inCharge'))),
            value: data.assigneeNames.join(', '),
            inline: true,
          });
        }
        break;
      case 'repeats':
        if (data.repeat) {
          fields.push({
            name: named(emoji(ICON.repeats), label(t('embed.fields.repeats'))),
            value: data.repeat,
          });
        }
        break;
      default:
        if (item.custom && item.text) {
          const text = toDiscord(renderSegments(item.text, values)).trim();
          if (text) blocks.push([text]);
        }
    }
  }

  // The link the title already makes, as a line of its own when the BDE asks for it.
  const link = httpUrl(data.url);
  const buttonLink = httpUrl(template?.button?.url ?? data.url);
  if (template?.button?.enabled === true && buttonLink) {
    const label = say(template.button.label ?? t(actionLabelKey(kind, 'slack')));
    // A closing parenthesis would end the link early.
    blocks.push([`${ICON.button}  [${label}](${buttonLink.replace(/\)/g, '%29')})`]);
  }

  const eyebrow = say(template?.eyebrow ?? t(KIND_LABEL_KEY[kind]));
  const lines: string[] = [kindLine(eyebrow), BLANK_LINE];
  blocks.forEach((block, index) => {
    if (index > 0) lines.push(BLANK_LINE);
    lines.push(...block);
  });
  lines.push(BLANK_LINE); // air between the text and the fields

  const title = say(template?.title ?? '{title}');
  return {
    title: named(template?.emoji ?? KIND_ICON[kind], title),
    url: link,
    color: colorToInt(template?.color ?? data.categoryColor),
    description: lines.join('\n'),
    fields,
    footer: { text: template?.footer !== undefined ? say(template.footer) : PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}
