import { normalizeHex } from '@/lib/notifications/colors';
import type { EmailModel } from '@/lib/notifications/email-layout';
import { neutralizeForSlack } from '@/lib/notifications/sanitize';
import {
  slackButton,
  slackDate,
  slackFooter,
  type SlackBlock,
  type SlackPayload,
} from '@/lib/notifications/slack-blocks';
import { truncate } from '@/lib/notifications/text';
import { KIND_LABEL_KEY, type EventCardKind } from './card-kind';
import {
  formatDate,
  formatDateTime,
  whenLine,
  type NotificationEventData,
  type Translate,
} from './messages';
import { isSameLocalDay } from './time';

/** How much of the event's description a message shows: it is a notice, the page has the rest. */
const DESCRIPTION_PREVIEW = 350;

/** A member's text for a `mrkdwn` field, cut first and then escaped (never cut in the middle of an
 * escape), so `<!channel>` and `<@U123>` come out as text. */
const text = (value: string, max: number) => neutralizeForSlack(truncate(value, max));

/** "Saturday, October 10th 8:00 PM → 11:00 PM", each reader seeing their own time zone. The fallback
 * text is what a client that cannot render the date shows. */
function whenValue(data: NotificationEventData, locale: string, timeZone: string): string {
  const start = slackDate(
    data.start,
    '{date_long_pretty} {time}',
    formatDateTime(data.start, locale, timeZone),
  );
  const end = isSameLocalDay(data.start, data.end, timeZone)
    ? slackDate(
        data.end,
        '{time}',
        new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(data.end),
      )
    : slackDate(data.end, '{date_long_pretty} {time}', formatDateTime(data.end, locale, timeZone));
  return `${start} → ${end}`;
}

/**
 * The event as a Slack message: the category's colour on the bar at its side, the title as the
 * heading, the facts in columns (when across the full width, then place, category, people in charge
 * and repetition two by two), dates in Slack's own markup, a button to the event and a footer with the
 * BDE's logo. `text` is what a phone's notification shows instead of all that.
 */
export function buildEventSlack(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
  brand: EmailModel['brand'],
): SlackPayload {
  const kindLabel = t(KIND_LABEL_KEY[kind]);
  const description = data.description?.trim();

  const column = (label: string, value: string) => ({
    type: 'mrkdwn' as const,
    text: `*${label}*\n${value}`,
  });
  const columns = [
    ...(data.location ? [column(t('embed.fields.where'), text(data.location, 400))] : []),
    column(t('embed.fields.category'), text(data.categoryLabel, 400)),
    ...(data.assigneeNames.length > 0
      ? [column(t('embed.fields.inCharge'), text(data.assigneeNames.join(', '), 400))]
      : []),
    ...(data.recurrence !== 'NONE' && data.recurrenceUntil
      ? [
          column(
            t('embed.fields.repeats'),
            t(`embed.repeatsValue.${data.recurrence}`, {
              until: slackDate(
                data.recurrenceUntil,
                '{date_long}',
                formatDate(data.recurrenceUntil, locale, timeZone),
              ),
            }),
          ),
        ]
      : []),
  ];

  const blocks: SlackBlock[] = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${kindLabel}*` }] },
    { type: 'header', text: { type: 'plain_text', text: data.title } },
    ...(description
      ? [
          {
            type: 'section' as const,
            text: { type: 'mrkdwn' as const, text: text(description, DESCRIPTION_PREVIEW) },
          },
        ]
      : []),
    { type: 'section', text: column(t('embed.fields.when'), whenValue(data, locale, timeZone)) },
    { type: 'section', fields: columns },
    ...(data.url ? [slackButton(t('slack.action'), data.url)] : []),
    slackFooter(brand),
  ];

  const where = data.location ? ` · ${truncate(data.location, 60)}` : '';
  return {
    fallback: `${kindLabel} : ${truncate(data.title, 120)} — ${whenLine(data, locale, timeZone)}${where}`,
    color: normalizeHex(data.categoryColor),
    blocks,
  };
}
