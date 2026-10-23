import { truncate } from '@/lib/notifications/text';
import type { EventCardKind } from './card-kind';
import { whenLine, type NotificationEventData, type Translate } from './messages';

/** How much of the event's description a variable stands for: it is a notice, the page has the rest. */
const DESCRIPTION_VARIABLE = 350;

/** The type of notification a card kind belongs to: the key of `notifications` in the configuration. */
export function templateTypeOf(
  kind: EventCardKind,
): 'eventConfirmed' | 'eventReminder' | 'eventProposed' | 'eventApproved' | 'eventRefused' {
  switch (kind) {
    case 'tomorrow':
    case 'today':
      return 'eventReminder';
    case 'proposed':
      return 'eventProposed';
    case 'approved':
      return 'eventApproved';
    case 'refused':
      return 'eventRefused';
    default:
      return 'eventConfirmed';
  }
}

/**
 * What each `{variable}` of an event's template stands for. Plain text, as the notification would say it: the
 * dates are written in the language of the BDE and in its time zone. An absent fact is an empty string.
 */
export function eventValues(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
  bdeName = '',
): Record<string, string> {
  const time = (date: Date) =>
    new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(date);
  return {
    title: data.title,
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone }).format(data.start),
    time: time(data.start),
    end_time: time(data.end),
    when: whenLine(data, locale, timeZone),
    place: data.location ?? '',
    category: data.categoryLabel,
    assignees: data.assigneeNames.join(', '),
    repeat: data.repeat ?? '',
    description: truncate(data.description?.trim() ?? '', DESCRIPTION_VARIABLE),
    link: data.url ?? '',
    bde: bdeName,
    day: kind === 'today' ? t('embed.day.today') : t('embed.day.tomorrow'),
    author: data.review?.authorName ?? '',
    reviewer: data.review?.reviewerName ?? '',
    comment: data.review?.comment ?? '',
  };
}
