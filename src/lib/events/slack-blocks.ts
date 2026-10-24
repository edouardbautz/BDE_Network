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
import { resolveItems, withEmoji } from '@/lib/notifications/templates/apply';
import { renderPlain, renderSegments, toSlack } from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import { truncate } from '@/lib/notifications/text';
import { KIND_LABEL_KEY, actionLabelKey, type EventCardKind } from './card-kind';
import { intraParts } from './intra-card';
import { formatDateTime, whenLine, type NotificationEventData, type Translate } from './messages';
import { eventAbove, eventValues, templateTypeOf } from './template-values';
import { isSameLocalDay } from './time';

/** How much of the event's description a message shows: it is a notice, the page has the rest. */
const DESCRIPTION_PREVIEW = 350;

/** A refusal's comment is the point of its message: it is shown nearly whole (the validator wrote at most 1000). */
const REASON_PREVIEW = 1000;

/** A member's text for a `mrkdwn` field, cut first and then escaped (never cut in the middle of an
 * escape), so `<!channel>` and `<@U123>` come out as text. */
const text = (value: string, max: number) => neutralizeForSlack(truncate(value, max));

/** The title with its emoji in front, when the BDE chose one (a Slack heading has none of its own). */
const named = (emoji: string | undefined, title: string) => (emoji ? `${emoji}  ${title}` : title);

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
 *
 * `context.template` changes what the BDE wants different (texts, colour, which facts and in which order, the button);
 * without it the message is the one the platform has always sent.
 */
export function buildEventSlack(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
  brand: EmailModel['brand'],
  context: TemplateContext = {},
): SlackPayload {
  const { template } = context;
  const values = eventValues(kind, data, t, locale, timeZone, context.bdeName ?? brand.name);
  const say = (source: string) => renderPlain(source, values);
  const kindLabel = say(template?.eyebrow ?? t(KIND_LABEL_KEY[kind]));
  const title = say(template?.title ?? '{title}');
  const description = data.description?.trim();
  const parts = intraParts(kind, data, t);

  const column = (label: string, value: string) => ({
    type: 'mrkdwn' as const,
    text: `*${label}*
${value}`,
  });
  // The top of the message (what was written, the date) and the columns (the other facts) are ordered each on its own.
  const top: SlackBlock[] = [];
  const columns: Array<ReturnType<typeof column>> = [];

  for (const item of resolveItems(template, 'slack', templateTypeOf(kind))) {
    const label = (fallback: string) => withEmoji(item.emoji, say(item.label ?? fallback));
    switch (item.id) {
      case 'reason':
        // The reason of a refusal comes first: it is what the author opens the message for.
        if (kind === 'refused' && data.review?.comment) {
          top.push({
            type: 'section',
            text: column(
              label(t('embed.fields.reason')),
              text(data.review.comment, REASON_PREVIEW),
            ),
          });
        } else if (parts.reason) {
          top.push({
            type: 'section',
            text: column(label(parts.reason.label), text(parts.reason.text, REASON_PREVIEW)),
          });
        }
        break;
      case 'changes':
        if (parts.changes) {
          top.push({
            type: 'section',
            text: column(
              label(parts.changes.label),
              parts.changes.lines.map((line) => text(line, 400)).join('\n'),
            ),
          });
        }
        break;
      case 'intraFields':
        if (parts.fields) {
          top.push({
            type: 'section',
            text: column(
              label(parts.fields.label),
              parts.fields.lines
                .map((line) => `${text(line.label, 80)} : ${text(line.value, 300)}`)
                .join('\n'),
            ),
          });
        }
        break;
      case 'requestedBy':
        if (parts.requestedBy) {
          columns.push(column(label(parts.requestedBy.label), text(parts.requestedBy.name, 400)));
        }
        break;
      case 'actedBy':
        if (parts.actor) {
          columns.push(column(label(parts.actor.label), text(parts.actor.name, 400)));
        }
        break;
      case 'intraLink':
        if (parts.link) {
          columns.push(column(label(parts.link.label), text(parts.link.url, 400)));
        }
        break;
      case 'description':
        if (description) {
          top.push({
            type: 'section',
            text: { type: 'mrkdwn', text: text(description, DESCRIPTION_PREVIEW) },
          });
        }
        break;
      case 'when':
        top.push({
          type: 'section',
          text: column(label(t('embed.fields.when')), whenValue(data, locale, timeZone)),
        });
        break;
      case 'where':
        if (data.location) {
          columns.push(column(label(t('embed.fields.where')), text(data.location, 400)));
        }
        break;
      case 'category':
        columns.push(column(label(t('embed.fields.category')), text(data.categoryLabel, 400)));
        break;
      case 'proposedBy':
        // The whole team reads a channel: the message says who it is about.
        if (data.review) {
          columns.push(
            column(label(t('embed.fields.proposedBy')), text(data.review.authorName, 400)),
          );
        }
        break;
      case 'reviewedBy':
        if (data.review?.reviewerName) {
          columns.push(
            column(
              label(t(kind === 'approved' ? 'embed.fields.approvedBy' : 'embed.fields.refusedBy')),
              text(data.review.reviewerName, 400),
            ),
          );
        }
        break;
      case 'assignees':
        if (data.assigneeNames.length > 0) {
          columns.push(
            column(label(t('embed.fields.inCharge')), text(data.assigneeNames.join(', '), 400)),
          );
        }
        break;
      case 'repeats':
        if (data.repeat)
          columns.push(column(label(t('embed.fields.repeats')), text(data.repeat, 400)));
        break;
      default:
        if (item.custom && item.text) {
          const written = toSlack(renderSegments(item.text, values)).trim();
          if (written) top.push({ type: 'section', text: { type: 'mrkdwn', text: written } });
        }
    }
  }

  const buttonUrl = template?.button?.url ?? data.url;
  const buttonLabel = say(template?.button?.label ?? t(actionLabelKey(kind, 'slack')));
  const blocks: SlackBlock[] = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${kindLabel}*` }] },
    { type: 'header', text: { type: 'plain_text', text: named(template?.emoji, title) } },
    ...top,
    ...(columns.length > 0 ? [{ type: 'section' as const, fields: columns }] : []),
    ...(buttonUrl && template?.button?.enabled !== false
      ? [slackButton(buttonLabel, buttonUrl)]
      : []),
    slackFooter(brand, template?.footer !== undefined ? say(template.footer) : undefined),
  ];

  const above = eventAbove('slack', kind, data, t, locale, timeZone, context);
  const where = data.location ? ` · ${truncate(data.location, 60)}` : '';
  return {
    fallback: `${kindLabel} : ${truncate(title, 120)} — ${whenLine(data, locale, timeZone)}${where}`,
    color: normalizeHex(template?.color ?? data.categoryColor),
    ...(above && { above: above.text }),
    blocks,
  };
}
