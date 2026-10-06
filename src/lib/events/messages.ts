import type { Translate } from '@/lib/notifications/translate';
import { toLocalDateTime } from './time';

export type { Translate };

export interface NotificationEventData {
  eventId: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryLabel: string;
  /** Hex colour of the category, or null when it has none any more. */
  categoryColor: string | null;
  assigneeNames: string[];
  start: Date;
  end: Date;
  recurrence: 'NONE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  recurrenceUntil: Date | null;
  /** Absolute link to the event, when APP_URL is configured. */
  url: string | null;
}

export interface BuiltMessage {
  subject: string;
  body: string;
}

function formatDateTime(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
}

export function whenLine(data: NotificationEventData, locale: string, timeZone: string): string {
  const startLocal = toLocalDateTime(data.start, timeZone);
  const endLocal = toLocalDateTime(data.end, timeZone);
  const sameDay =
    startLocal.year === endLocal.year &&
    startLocal.month === endLocal.month &&
    startLocal.day === endLocal.day;

  const startText = formatDateTime(data.start, locale, timeZone);
  const endText = sameDay
    ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(data.end)
    : formatDateTime(data.end, locale, timeZone);

  return `${startText} → ${endText}`;
}

function detailLines(
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
): string[] {
  const lines = [whenLine(data, locale, timeZone)];

  if (data.recurrence !== 'NONE' && data.recurrenceUntil) {
    lines.push(
      t('recurring', {
        frequency: t(`frequency.${data.recurrence}`),
        until: formatDate(data.recurrenceUntil, locale, timeZone),
      }),
    );
  }
  if (data.location) lines.push(`${t('location')} : ${data.location}`);
  lines.push(`${t('category')} : ${data.categoryLabel}`);
  if (data.assigneeNames.length > 0) {
    lines.push(`${t('inCharge')} : ${data.assigneeNames.join(', ')}`);
  }
  if (data.url) lines.push(`${t('link')} : ${data.url}`);
  return lines;
}

/** "An event was confirmed" message. `data.start` is the next occurrence. */
export function buildConfirmationMessage(
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
): BuiltMessage {
  return {
    subject: t('confirmed.subject', { title: data.title }),
    body: [t('confirmed.intro'), '', ...detailLines(data, t, locale, timeZone)].join('\n'),
  };
}

/** Which day a reminder talks about: the day after it is sent, or the same day when the server was
 * down at the usual time and the reminder goes out late (a catch-up). */
export type ReminderDay = 'tomorrow' | 'today';

/** Reminder. `data.start` is the occurrence being reminded about. */
export function buildReminderMessage(
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
  day: ReminderDay = 'tomorrow',
): BuiltMessage {
  const key = day === 'today' ? 'reminderToday' : 'reminder';
  return {
    subject: t(`${key}.subject`, { title: data.title }),
    body: [t(`${key}.intro`), '', ...detailLines(data, t, locale, timeZone)].join('\n'),
  };
}
