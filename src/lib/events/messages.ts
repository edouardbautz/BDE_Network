import type { Translate } from '@/lib/notifications/translate';
import { toLocalDateTime } from './time';

export type { Translate };

/** What a message of the proposal circuit says besides the event: who proposed it, who reviewed it and the
 * reason of a refusal. */
export interface ReviewFacts {
  /** The author of the proposal, by name. */
  authorName: string;
  /** The validator who approved or refused, by name; null for a proposal that nobody reviewed yet. */
  reviewerName: string | null;
  /** The comment of a refusal. */
  comment: string | null;
}

/** What a message about the publication on the intra says besides the event (see `intra-facts.ts`, which makes it). */
export interface IntraFacts {
  /** Who asked for the publication (the person who confirmed the event, or asked again), by name. */
  requestedByName: string | null;
  /** Who changed or took back the event, or the staff member who answered, by name. */
  actorName: string | null;
  /** The reason the staff gave for a refusal. */
  comment: string | null;
  /** Why the request was taken back, as a sentence. */
  cause: string | null;
  /** The address of the event on the intra, when the staff gave one. */
  intraUrl: string | null;
  /** The fields of the intra's form, as `label: value` (for a request). */
  fields: { label: string; value: string }[];
  /** What changed since the event was published, one line each (for a change). */
  changes: string[];
}

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
  /** The sentence that says how the event repeats ("Every week on Monday, until…"); null when it does not. */
  repeat: string | null;
  /** Absolute link to the event, when APP_URL is configured. */
  url: string | null;
  /** Only in the messages of the proposal circuit. */
  review?: ReviewFacts;
  /** Only in the messages about the publication on the intra. */
  intra?: IntraFacts;
}

export interface BuiltMessage {
  subject: string;
  body: string;
}

export function formatDateTime(date: Date, locale: string, timeZone: string): string {
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

  if (data.repeat) lines.push(data.repeat);
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

/** The three messages of the proposal circuit: an event proposed (to the validators), approved or refused (to its
 * author). A refusal carries the validator's comment. */
export function buildReviewMessage(
  kind: 'proposed' | 'approved' | 'refused',
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
): BuiltMessage {
  const review = data.review;
  const intro = t(`${kind}.intro`, {
    author: review?.authorName ?? '',
    reviewer: review?.reviewerName ?? '',
  });
  const lines = [intro, ''];
  if (kind === 'refused' && review?.comment) {
    lines.push(`${t('embed.fields.reason')} :`, review.comment, '');
  }
  lines.push(...detailLines(data, t, locale, timeZone));
  return { subject: t(`${kind}.subject`, { title: data.title }), body: lines.join('\n') };
}

/**
 * The five messages about the publication on the intra: the staff asked (`intraRequested`), told that an event changed
 * (`intraChanged`) or was taken back (`intraCancelled`); the author told it was published or refused. The plain text a channel
 * falls back on: the sentence, what is specific to the kind, then the date and the place.
 */
export function buildIntraMessage(
  kind: 'intraRequested' | 'intraChanged' | 'intraCancelled' | 'intraPublished' | 'intraRefused',
  data: NotificationEventData,
  t: Translate,
  locale: string,
  timeZone: string,
): BuiltMessage {
  const facts = data.intra;
  const lines = [
    t(`intra.${kind}.intro`, {
      requester: facts?.requestedByName ?? '',
      actor: facts?.actorName ?? '',
    }),
    '',
  ];
  if (kind === 'intraRefused' && facts?.comment) {
    lines.push(`${t('embed.fields.reason')} :`, facts.comment, '');
  }
  if (kind === 'intraCancelled' && facts?.cause) {
    lines.push(`${t('embed.fields.reason')} : ${facts.cause}`, '');
  }
  if (kind === 'intraChanged' && facts && facts.changes.length > 0) {
    lines.push(`${t('embed.fields.changes')} :`, ...facts.changes, '');
  }
  if (kind === 'intraRequested' && facts && facts.fields.length > 0) {
    lines.push(...facts.fields.map((field) => `${field.label} : ${field.value}`), '');
  }
  lines.push(whenLine(data, locale, timeZone));
  if (data.repeat) lines.push(data.repeat);
  if (data.location) lines.push(`${t('location')} : ${data.location}`);
  if (kind === 'intraPublished' && facts?.intraUrl) {
    lines.push(`${t('embed.fields.intraLink')} : ${facts.intraUrl}`);
  }
  if (data.url) lines.push(`${t('link')} : ${data.url}`);
  return { subject: t(`intra.${kind}.subject`, { title: data.title }), body: lines.join('\n') };
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
