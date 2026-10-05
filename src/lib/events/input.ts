import type { EventRecurrence, EventStatus } from '@/generated/prisma/client';
import { MAX_OCCURRENCES, allOccurrences } from './recurrence';
import { fromLocalDateTime, parseLocalDateInput, parseLocalInput, schoolYearOf } from './time';

export const EVENT_RECURRENCES: readonly EventRecurrence[] = [
  'NONE',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
];
export const EVENT_STATUSES: readonly EventStatus[] = ['DRAFT', 'CONFIRMED'];

export const TITLE_MAX_LENGTH = 120;
export const LOCATION_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;

export type EventFormField =
  | 'title'
  | 'description'
  | 'location'
  | 'categoryKey'
  | 'startsAt'
  | 'endsAt'
  | 'recurrence'
  | 'recurrenceUntil'
  | 'status';

/** Keys of `events.form.errors.*` in the message catalogs. */
export type EventFormErrorCode =
  | 'required'
  | 'tooLong'
  | 'invalid'
  | 'endBeforeStart'
  | 'untilRequired'
  | 'untilBeforeStart'
  | 'tooManyOccurrences';

export type EventFormErrors = Partial<Record<EventFormField, EventFormErrorCode>>;

/** Raw values as submitted by the form (all strings, wall-clock dates). */
export interface RawEventInput {
  title: string;
  description: string;
  location: string;
  categoryKey: string;
  startsAt: string;
  endsAt: string;
  recurrence: string;
  recurrenceUntil: string;
  status: string;
  assigneeLogins: string[];
}

export interface EventData {
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  recurrence: EventRecurrence;
  recurrenceUntil: Date | null;
  schoolYear: string;
  assigneeLogins: string[];
}

export type ParsedEventInput =
  { ok: true; data: EventData } | { ok: false; errors: EventFormErrors };

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * Validates and normalises the event form. Dates are wall-clock values in
 * `timeZone` (the BDE timezone) and are converted to UTC here — the only
 * place a form date becomes an instant.
 */
export function parseEventInput(
  raw: RawEventInput,
  options: { timeZone: string; categoryKeys: readonly string[] },
): ParsedEventInput {
  const errors: EventFormErrors = {};

  const title = raw.title.trim();
  if (!title) errors.title = 'required';
  else if (title.length > TITLE_MAX_LENGTH) errors.title = 'tooLong';

  const location = raw.location.trim();
  if (location.length > LOCATION_MAX_LENGTH) errors.location = 'tooLong';

  const description = raw.description.trim();
  if (description.length > DESCRIPTION_MAX_LENGTH) errors.description = 'tooLong';

  if (!isOneOf(options.categoryKeys, raw.categoryKey)) errors.categoryKey = 'invalid';
  if (!isOneOf(EVENT_STATUSES, raw.status)) errors.status = 'invalid';

  const recurrenceIsValid = isOneOf(EVENT_RECURRENCES, raw.recurrence);
  if (!recurrenceIsValid) errors.recurrence = 'invalid';

  const startLocal = raw.startsAt ? parseLocalInput(raw.startsAt) : null;
  const endLocal = raw.endsAt ? parseLocalInput(raw.endsAt) : null;
  if (!raw.startsAt) errors.startsAt = 'required';
  else if (!startLocal) errors.startsAt = 'invalid';
  if (!raw.endsAt) errors.endsAt = 'required';
  else if (!endLocal) errors.endsAt = 'invalid';

  const startsAt = startLocal ? fromLocalDateTime(startLocal, options.timeZone) : null;
  const endsAt = endLocal ? fromLocalDateTime(endLocal, options.timeZone) : null;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    errors.endsAt = 'endBeforeStart';
  }

  const recurrence = recurrenceIsValid ? (raw.recurrence as EventRecurrence) : 'NONE';
  let recurrenceUntil: Date | null = null;

  if (recurrence !== 'NONE') {
    const untilLocal = raw.recurrenceUntil ? parseLocalDateInput(raw.recurrenceUntil) : null;
    if (!raw.recurrenceUntil) {
      errors.recurrenceUntil = 'untilRequired';
    } else if (!untilLocal) {
      errors.recurrenceUntil = 'invalid';
    } else {
      // The chosen day is inclusive: an occurrence starting that day still counts.
      recurrenceUntil = fromLocalDateTime(
        { ...untilLocal, hour: 23, minute: 59 },
        options.timeZone,
      );
      if (startsAt && recurrenceUntil.getTime() < startsAt.getTime()) {
        errors.recurrenceUntil = 'untilBeforeStart';
      }
    }
  }

  if (Object.keys(errors).length > 0 || !startsAt || !endsAt) {
    // Surface "too many occurrences" only when everything else is fine, so it
    // is never reported next to an unrelated error.
    return { ok: false, errors };
  }

  if (recurrence !== 'NONE' && recurrenceUntil) {
    const occurrences = allOccurrences(
      { startsAt, endsAt, recurrence, recurrenceUntil },
      options.timeZone,
    );
    // allOccurrences stops at the cap, so reaching it means the series was cut short.
    if (occurrences.length >= MAX_OCCURRENCES) {
      return { ok: false, errors: { recurrenceUntil: 'tooManyOccurrences' } };
    }
  }

  return {
    ok: true,
    data: {
      title,
      description: description || null,
      location: location || null,
      categoryKey: raw.categoryKey,
      status: raw.status as EventStatus,
      startsAt,
      endsAt,
      recurrence,
      recurrenceUntil,
      schoolYear: schoolYearOf(startsAt, options.timeZone),
      assigneeLogins: [...new Set(raw.assigneeLogins.map((login) => login.trim()).filter(Boolean))],
    },
  };
}
