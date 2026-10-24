import type { IntraAudience } from '@/generated/prisma/client';
import { truncate } from '@/lib/notifications/text';
import { dateValues, diffContent, type IntraContent, type IntraDate } from './intra-request';
import type { IntraFacts, Translate } from './messages';

/**
 * What the messages about the publication on the intra say of the event, written in the language of the BDE: the fields of the intra's
 * form, what changed since the event was published, why a request was taken back. Plain text (every channel makes it harmless).
 */

/** The longest value of a changed field a line quotes: a description may be long, the page has the rest. */
const VALUE_PREVIEW = 160;

const words = (t: Translate) => ({
  audience: (audience: IntraAudience) => t(`intraFields.audiences.${audience}`),
  waitingList: (value: boolean) => t(value ? 'intraFields.yes' : 'intraFields.no'),
});

/** One date as the staff reads it in the intra's form: `05/10/2026 18:00 → 20:00` (the end day only when it is another one). */
export function dateText(date: IntraDate, timeZone: string): string {
  const v = dateValues(date, timeZone);
  const end = v.endDate === v.startDate ? v.endTime : `${v.endDate} ${v.endTime}`;
  return `${v.startDate} ${v.startTime} → ${end}`;
}

/** The fields of the intra's form that the event card does not show already, as label and value. */
export function intraFieldLines(
  content: IntraContent,
  t: Translate,
): { label: string; value: string }[] {
  const { fields } = content;
  const say = words(t);
  return [
    { label: t('intraFields.organizerLogin'), value: fields.organizerLogin },
    { label: t('intraFields.availableFor'), value: say.audience(fields.audience) },
    { label: t('intraFields.maxPeople'), value: String(fields.maxPeople) },
    { label: t('intraFields.waitingList'), value: say.waitingList(fields.waitingList) },
    { label: t('intraFields.kind'), value: fields.kind },
    { label: t('intraFields.unsubscribeHours'), value: String(fields.unsubscribeHours) },
    { label: t('intraFields.keywords'), value: fields.keywords.join(', ') },
  ];
}

/** What differs between what the intra holds and what the event is now, one line each: old and new value, dates to remove and to add. */
export function intraChangeLines(
  before: IntraContent,
  after: IntraContent,
  t: Translate,
  timeZone: string,
): string[] {
  const change = diffContent(before, after, words(t));
  const lines = change.fields.map(({ field, before: was, after: now }) =>
    t('embed.changes.field', {
      label: t(`intraFields.${field}`),
      before: was === '' ? '—' : truncate(was, VALUE_PREVIEW),
      after: now === '' ? '—' : truncate(now, VALUE_PREVIEW),
    }),
  );
  for (const date of change.removed) {
    lines.push(t('embed.changes.removed', { date: dateText(date, timeZone) }));
  }
  for (const date of change.added) {
    lines.push(t('embed.changes.added', { date: dateText(date, timeZone) }));
  }
  for (const { after: date } of change.edited) {
    lines.push(t('embed.changes.edited', { date: dateText(date, timeZone) }));
  }
  return lines;
}

/** Why a request was taken back, as a sentence. */
export type IntraCause = 'draft' | 'deleted' | 'dates';

export const causeText = (cause: IntraCause, t: Translate): string => t(`embed.cause.${cause}`);

const NO_FACTS: IntraFacts = {
  requestedByName: null,
  actorName: null,
  comment: null,
  cause: null,
  intraUrl: null,
  fields: [],
  changes: [],
};

/** The facts of a message, from what is known: whatever is not given is absent. */
export const intraFacts = (given: Partial<IntraFacts>): IntraFacts => ({ ...NO_FACTS, ...given });
