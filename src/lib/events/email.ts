import { renderEmail } from '@/lib/notifications/email-layout';
import type { EmailModel } from '@/lib/notifications/email-layout';
import type { EmailContent } from '@/lib/notifications/types';
import { resolveItems, withEmoji } from '@/lib/notifications/templates/apply';
import {
  renderPlain,
  renderSegments,
  toPlainText,
  type Segment,
} from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import { truncate } from '@/lib/notifications/text';
import { whenLine, type NotificationEventData, type Translate } from './messages';
import { KIND_LABEL_KEY, STAFF_KINDS, actionLabelKey, type EventCardKind } from './card-kind';
import { intraParts } from './intra-card';
import { buildIcs, icsFilename, occurrenceUid } from './ics';
import { eventValues, templateTypeOf } from './template-values';

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
 * The event as an e-mail: the category's colour on the bar, the BDE's on the button, the facts as rows and a
 * button to the event's page. A confirmation carries the event as an iCalendar file (`ics`), which
 * mail clients turn into an "add to calendar" offer; the reminder does not, the member already has
 * it.
 *
 * `context.template` changes what the BDE wants different (subject, texts, colour, which facts and in which order, the button);
 * without it the e-mail is the one the platform has always sent.
 */
export function buildEventEmail(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
  brand: EmailModel['brand'],
  ics?: EmailContent['ics'],
  context: TemplateContext = {},
): EmailContent {
  const { template } = context;
  const values = eventValues(kind, data, t, locale, timeZone, context.bdeName ?? brand.name);
  const say = (source: string) => renderPlain(source, values);
  const description = data.description?.trim();
  const parts = intraParts(kind, data, t);

  let lead: string | undefined;
  const paragraphs: Segment[][] = [];
  const fields: EmailModel['fields'] = [];

  for (const item of resolveItems(template, 'email', templateTypeOf(kind))) {
    const label = (fallback: string) => withEmoji(item.emoji, say(item.label ?? fallback));
    switch (item.id) {
      case 'reason':
        // The reason of a refusal is what the author reads the e-mail for: it takes the place of the description.
        if (lead === undefined && kind === 'refused' && data.review?.comment) {
          lead = `${label(t('embed.fields.reason'))} :
${data.review.comment}`;
        } else if (lead === undefined && parts.reason) {
          lead = `${label(parts.reason.label)} :
${parts.reason.text}`;
        }
        break;
      case 'changes':
        if (parts.changes) {
          paragraphs.push([{ text: `${label(parts.changes.label)} :`, bold: true }]);
          for (const line of parts.changes.lines) paragraphs.push([{ text: line }]);
        }
        break;
      case 'intraFields':
        for (const line of parts.fields?.lines ?? []) {
          fields.push({ label: line.label, value: line.value });
        }
        break;
      case 'requestedBy':
        if (parts.requestedBy) {
          fields.push({ label: label(parts.requestedBy.label), value: parts.requestedBy.name });
        }
        break;
      case 'actedBy':
        if (parts.actor) fields.push({ label: label(parts.actor.label), value: parts.actor.name });
        break;
      case 'intraLink':
        if (parts.link) fields.push({ label: label(parts.link.label), value: parts.link.url });
        break;
      case 'description':
        if (lead === undefined && description) lead = truncate(description, DESCRIPTION_PREVIEW);
        break;
      case 'when':
        fields.push({
          label: label(t('embed.fields.when')),
          value: whenLine(data, locale, timeZone),
        });
        break;
      case 'repeats':
        if (data.repeat)
          fields.push({ label: label(t('embed.fields.repeats')), value: data.repeat });
        break;
      case 'where':
        if (data.location) {
          fields.push({ label: label(t('embed.fields.where')), value: data.location });
        }
        break;
      case 'category':
        fields.push({
          label: label(t('embed.fields.category')),
          value: data.categoryLabel,
          ...(data.categoryColor && { marker: data.categoryColor }),
        });
        break;
      case 'assignees':
        if (data.assigneeNames.length > 0) {
          fields.push({
            label: label(t('embed.fields.inCharge')),
            value: data.assigneeNames.join(', '),
          });
        }
        break;
      case 'proposedBy':
        if (data.review) {
          fields.push({
            label: label(t('embed.fields.proposedBy')),
            value: data.review.authorName,
          });
        }
        break;
      case 'reviewedBy':
        if (data.review?.reviewerName) {
          fields.push({
            label: label(
              t(kind === 'approved' ? 'embed.fields.approvedBy' : 'embed.fields.refusedBy'),
            ),
            value: data.review.reviewerName,
          });
        }
        break;
      default:
        if (item.custom && item.text) {
          const segments = renderSegments(item.text, values);
          if (toPlainText(segments).trim()) paragraphs.push(segments);
        }
    }
  }

  const eyebrow = say(template?.eyebrow ?? t(KIND_LABEL_KEY[kind]));
  const actionLabel = say(template?.button?.label ?? t(actionLabelKey(kind, 'email')));
  const buttonUrl = template?.button?.url ?? data.url;
  const showButton = buttonUrl && template?.button?.enabled !== false;
  const note =
    template?.note !== undefined ? say(template.note) : ics ? t('email.calendarNote') : '';
  const rendered = renderEmail({
    lang: locale,
    preheader:
      template?.preheader !== undefined
        ? say(template.preheader)
        : [eyebrow, shortWhen(data, locale, timeZone), data.location].filter(Boolean).join(' · '),
    brand,
    accent: template?.color ?? data.categoryColor ?? '',
    eyebrow,
    heading: say(template?.title ?? '{title}'),
    ...(lead && { lead }),
    ...(paragraphs.length > 0 && { paragraphs }),
    fields,
    ...(showButton && { action: { label: actionLabel, url: buttonUrl } }),
    ...(note && { note }),
    footer:
      template?.footer !== undefined
        ? say(template.footer)
        : t(
            kind === 'test'
              ? 'email.footerTest'
              : STAFF_KINDS.includes(kind)
                ? 'email.staffFooter'
                : 'email.footer',
            { bde: brand.name },
          ),
  });

  return {
    ...rendered,
    ...(template?.subject !== undefined && { subject: say(template.subject) }),
    ...(ics && { ics }),
  };
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
