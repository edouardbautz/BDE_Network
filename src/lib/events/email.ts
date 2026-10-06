import { renderEmail } from '@/lib/notifications/email-layout';
import type { EmailModel } from '@/lib/notifications/email-layout';
import type { EmailContent } from '@/lib/notifications/types';
import { truncate } from '@/lib/notifications/text';
import { formatDate, whenLine, type NotificationEventData, type Translate } from './messages';
import type { EventCardKind } from './discord-embed';
import { buildIcs, icsFilename, occurrenceUid } from './ics';

/** The kind of message, as the small line above the heading. Shared with the Discord card. */
const KIND_LABEL_KEY: Record<EventCardKind, string> = {
  confirmed: 'embed.kind.confirmed',
  tomorrow: 'embed.kind.reminderTomorrow',
  today: 'embed.kind.reminderToday',
};

/** How much of the description an e-mail shows: a notice, the page has the rest. */
const DESCRIPTION_PREVIEW = 600;

/** "samedi 10 octobre, 20:00": what the inbox shows next to the subject. */
function shortWhen(data: NotificationEventData, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(data.start);
}

/**
 * The event as an e-mail: the category's colour on the bar and the button, the facts as rows and a
 * button to the event's page. A confirmation carries the event as an iCalendar file (`ics`), which
 * mail clients turn into an "add to calendar" offer; the reminder does not, the member already has
 * it.
 */
export function buildEventEmail(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
  brand: EmailModel['brand'],
  ics?: EmailContent['ics'],
): EmailContent {
  const description = data.description?.trim();

  const fields: EmailModel['fields'] = [
    { label: t('embed.fields.when'), value: whenLine(data, locale, timeZone) },
  ];
  if (data.recurrence !== 'NONE' && data.recurrenceUntil) {
    fields.push({
      label: t('embed.fields.repeats'),
      value: t(`embed.repeatsValue.${data.recurrence}`, {
        until: formatDate(data.recurrenceUntil, locale, timeZone),
      }),
    });
  }
  if (data.location) fields.push({ label: t('embed.fields.where'), value: data.location });
  fields.push({
    label: t('embed.fields.category'),
    value: data.categoryLabel,
    ...(data.categoryColor && { marker: data.categoryColor }),
  });
  if (data.assigneeNames.length > 0) {
    fields.push({ label: t('embed.fields.inCharge'), value: data.assigneeNames.join(', ') });
  }

  const eyebrow = t(KIND_LABEL_KEY[kind]);
  const rendered = renderEmail({
    lang: locale,
    preheader: [eyebrow, shortWhen(data, locale, timeZone), data.location]
      .filter(Boolean)
      .join(' · '),
    brand,
    accent: data.categoryColor ?? '',
    eyebrow,
    heading: data.title,
    ...(description && { lead: truncate(description, DESCRIPTION_PREVIEW) }),
    fields,
    ...(data.url && { action: { label: t('email.action'), url: data.url } }),
    ...(ics && { note: t('email.calendarNote') }),
    footer: t('email.footer', { bde: brand.name }),
  });

  return { ...rendered, ...(ics && { ics }) };
}

/** The calendar file attached to a confirmation: every occurrence still to come, under the same
 * identifiers as the subscription feeds, so a client that already has the event updates it instead of
 * adding it twice. */
export function buildEventIcs(
  event: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    updatedAt: Date;
  },
  occurrences: readonly { start: Date; end: Date }[],
  category: string,
  calendarName: string,
  now: Date = new Date(),
): NonNullable<EmailContent['ics']> {
  return {
    filename: icsFilename(event.title),
    content: buildIcs(
      {
        name: calendarName,
        events: occurrences.map((occurrence) => ({
          uid: occurrenceUid(event.id, occurrence.start),
          start: occurrence.start,
          end: occurrence.end,
          summary: event.title,
          description: event.description,
          location: event.location,
          confirmed: true,
          category,
          lastModified: event.updatedAt,
        })),
      },
      now,
    ),
  };
}
