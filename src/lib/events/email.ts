import { renderEmail } from '@/lib/notifications/email-layout';
import type { EmailModel } from '@/lib/notifications/email-layout';
import type { EmailContent } from '@/lib/notifications/types';
import { truncate } from '@/lib/notifications/text';
import { whenLine, type NotificationEventData, type Translate } from './messages';
import { KIND_LABEL_KEY, actionLabelKey, type EventCardKind } from './card-kind';
import { buildIcs, icsFilename, occurrenceUid } from './ics';

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
  // The reason of a refusal is what the author reads the e-mail for: it takes the place of the description.
  const lead =
    kind === 'refused' && data.review?.comment
      ? `${t('embed.fields.reason')} :
${data.review.comment}`
      : description
        ? truncate(description, DESCRIPTION_PREVIEW)
        : undefined;

  const fields: EmailModel['fields'] = [
    { label: t('embed.fields.when'), value: whenLine(data, locale, timeZone) },
  ];
  if (data.repeat) fields.push({ label: t('embed.fields.repeats'), value: data.repeat });
  if (data.location) fields.push({ label: t('embed.fields.where'), value: data.location });
  fields.push({
    label: t('embed.fields.category'),
    value: data.categoryLabel,
    ...(data.categoryColor && { marker: data.categoryColor }),
  });
  if (data.assigneeNames.length > 0) {
    fields.push({ label: t('embed.fields.inCharge'), value: data.assigneeNames.join(', ') });
  }
  if (data.review) {
    fields.push({ label: t('embed.fields.proposedBy'), value: data.review.authorName });
    if (data.review.reviewerName) {
      fields.push({
        label: t(kind === 'approved' ? 'embed.fields.approvedBy' : 'embed.fields.refusedBy'),
        value: data.review.reviewerName,
      });
    }
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
    ...(lead && { lead }),
    fields,
    ...(data.url && { action: { label: t(actionLabelKey(kind, 'email')), url: data.url } }),
    ...(ics && { note: t('email.calendarNote') }),
    footer: t(kind === 'test' ? 'email.footerTest' : 'email.footer', { bde: brand.name }),
  });

  return { ...rendered, ...(ics && { ics }) };
}

/** One date of the calendar file attached to a confirmation. */
export interface IcsDate {
  /** Where the series puts the date: with the series' key, its identifier in every calendar file. */
  originalStart: Date;
  start: Date;
  end: Date;
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  updatedAt: Date;
}

/** The calendar file attached to a confirmation: the dates announced, under the same identifiers as the
 * subscription feeds, so a client that already has the event updates it instead of adding it twice. */
export function buildEventIcs(
  seriesKey: string,
  dates: readonly IcsDate[],
  calendarName: string,
  now: Date = new Date(),
): NonNullable<EmailContent['ics']> {
  return {
    filename: icsFilename(dates[0]?.title ?? ''),
    content: buildIcs(
      {
        name: calendarName,
        events: dates.map((date) => ({
          uid: occurrenceUid(seriesKey, date.originalStart),
          start: date.start,
          end: date.end,
          summary: date.title,
          description: date.description,
          location: date.location,
          confirmed: true,
          category: date.category,
          lastModified: date.updatedAt,
        })),
      },
      now,
    ),
  };
}
