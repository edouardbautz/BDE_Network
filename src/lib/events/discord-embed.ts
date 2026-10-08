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
import { httpUrl, truncate } from '@/lib/notifications/text';
import { KIND_LABEL_KEY, type EventCardKind } from './card-kind';
import type { NotificationEventData, Translate } from './messages';
import { toLocalDateTime } from './time';

/** How much of the event's description a card shows: it is a notice, the page has the rest. */
const DESCRIPTION_PREVIEW = 350;

/** One icon in front of the title of each kind of card, and of each line of facts. */
const KIND_ICON: Record<EventCardKind, string> = { confirmed: '🎉', tomorrow: '⏰', today: '🔔' };
const ICON = { when: '📅', where: '📍', category: '🏷️', inCharge: '👥', repeats: '🔁' } as const;

/** "15:00 → 18:00 · in 2 days", the end as a full date when the event ends another day. */
function timeLine(data: NotificationEventData, timeZone: string): string {
  const start = toLocalDateTime(data.start, timeZone);
  const end = toLocalDateTime(data.end, timeZone);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;

  const range = `${discordTime(data.start, 't')} → ${discordTime(data.end, sameDay ? 't' : 'F')}`;
  // The countdown moves by itself ("in 2 days") without the message being edited.
  return `${range}  ·  ${discordTime(data.start, 'R')}`;
}

/**
 * The event as a Discord card. The essentials (what, when, where) are large headings in the description,
 * each with its icon and a blank line between them, the description of the event as a quote under them;
 * the secondary facts (category, people in charge, repetition) are small fields underneath. The category's
 * colour is on the bar, the title links to the event, the dates are in Discord's own markup. `now` stamps
 * the footer. The BDE's name and logo are added around it by `withDiscordCard`.
 */
export function buildEventEmbed(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  timeZone: string,
  now: Date = new Date(),
): DiscordEmbed {
  const description = data.description?.trim();

  const fields: NonNullable<DiscordEmbed['fields']> = [
    {
      name: `${ICON.category}  ${t('embed.fields.category')}`,
      value: data.categoryLabel,
      inline: true,
    },
  ];
  if (data.assigneeNames.length > 0) {
    fields.push({
      name: `${ICON.inCharge}  ${t('embed.fields.inCharge')}`,
      value: data.assigneeNames.join(', '),
      inline: true,
    });
  }
  if (data.recurrence !== 'NONE' && data.recurrenceUntil) {
    fields.push({
      name: `${ICON.repeats}  ${t('embed.fields.repeats')}`,
      value: t(`embed.repeatsValue.${data.recurrence}`, {
        until: discordTime(data.recurrenceUntil, 'D'),
      }),
    });
  }

  const lines = [
    kindLine(t(KIND_LABEL_KEY[kind])),
    BLANK_LINE,
    headingLine(ICON.when, discordTime(data.start, 'F')),
    timeLine(data, timeZone),
  ];
  if (data.location) lines.push(BLANK_LINE, headingLine(ICON.where, data.location));
  if (description) lines.push(BLANK_LINE, quoteBlock(truncate(description, DESCRIPTION_PREVIEW)));
  lines.push(BLANK_LINE); // air between the text and the fields

  return {
    title: `${KIND_ICON[kind]}  ${data.title}`,
    url: httpUrl(data.url),
    color: colorToInt(data.categoryColor),
    description: lines.join('\n'),
    fields,
    footer: { text: PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}
