import { colorToInt, discordTime, type DiscordEmbed } from '@/lib/notifications/discord-embed';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { httpUrl, truncate } from '@/lib/notifications/text';
import type { NotificationEventData, ReminderDay, Translate } from './messages';
import { toLocalDateTime } from './time';

/** What the card announces: a new confirmed event, or a reminder for today or for tomorrow. */
export type EventCardKind = 'confirmed' | ReminderDay;

const KIND_LABEL_KEY: Record<EventCardKind, string> = {
  confirmed: 'embed.kind.confirmed',
  tomorrow: 'embed.kind.reminderTomorrow',
  today: 'embed.kind.reminderToday',
};

/** How much of the event's description a card shows: it is a notice, the page has the rest. */
const DESCRIPTION_PREVIEW = 350;

/** "Wed 7 Oct 8 pm → 11 pm", in the reader's own language and time zone (Discord renders it). */
function whenValue(data: NotificationEventData, timeZone: string): string {
  const start = toLocalDateTime(data.start, timeZone);
  const end = toLocalDateTime(data.end, timeZone);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;

  const range = `${discordTime(data.start, 'F')} → ${discordTime(data.end, sameDay ? 't' : 'F')}`;
  // The second line counts down by itself ("in 2 days") without the message being edited.
  return `${range}\n${discordTime(data.start, 'R')}`;
}

/**
 * The event as a Discord card: the category's colour on the bar, the title linking to the event,
 * the practical facts in columns (when full width, then place, category and people in charge side
 * by side) and the dates in Discord's own markup. `now` stamps the footer.
 */
export function buildEventEmbed(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  timeZone: string,
  now: Date = new Date(),
): DiscordEmbed {
  const heading = `**${t(KIND_LABEL_KEY[kind])}**`;
  const description = data.description?.trim();

  const fields: NonNullable<DiscordEmbed['fields']> = [
    { name: t('embed.fields.when'), value: whenValue(data, timeZone) },
  ];
  if (data.recurrence !== 'NONE' && data.recurrenceUntil) {
    fields.push({
      name: t('embed.fields.repeats'),
      value: t(`embed.repeatsValue.${data.recurrence}`, {
        until: discordTime(data.recurrenceUntil, 'D'),
      }),
    });
  }
  if (data.location) {
    fields.push({ name: t('embed.fields.where'), value: data.location, inline: true });
  }
  fields.push({ name: t('embed.fields.category'), value: data.categoryLabel, inline: true });
  if (data.assigneeNames.length > 0) {
    fields.push({
      name: t('embed.fields.inCharge'),
      value: data.assigneeNames.join(', '),
      inline: true,
    });
  }

  return {
    title: data.title,
    url: httpUrl(data.url),
    color: colorToInt(data.categoryColor),
    description: description
      ? `${heading}\n${truncate(description, DESCRIPTION_PREVIEW)}`
      : heading,
    fields,
    footer: { text: PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}
