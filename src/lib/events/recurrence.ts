import type { EventRecurrence } from '@/generated/prisma/client';
import { addDays, fromLocalDateTime, toLocalDateTime, type LocalDate } from './time';

/** Safety cap on a single series (a weekly event over ~4 years). */
export const MAX_OCCURRENCES = 200;

export interface RecurringSource {
  startsAt: Date;
  endsAt: Date;
  recurrence: EventRecurrence;
  recurrenceUntil: Date | null;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every occurrence of an event, computed on the wall clock of `timeZone` so a
 * "weekly at 20:00" event stays at 20:00 local time across DST changes.
 * Monthly events repeat on the same day of the month; in a shorter month they
 * fall on its last day (31st → 30th/28th). Stops at `recurrenceUntil`
 * (inclusive) or after MAX_OCCURRENCES, whichever comes first.
 */
export function allOccurrences(source: RecurringSource, timeZone: string): Occurrence[] {
  if (source.recurrence === 'NONE' || !source.recurrenceUntil) {
    return [{ start: source.startsAt, end: source.endsAt }];
  }

  const durationMs = source.endsAt.getTime() - source.startsAt.getTime();
  const base = toLocalDateTime(source.startsAt, timeZone);
  const occurrences: Occurrence[] = [];

  for (let index = 0; index < MAX_OCCURRENCES; index += 1) {
    let date: LocalDate;

    if (source.recurrence === 'MONTHLY') {
      const monthIndex = base.month - 1 + index;
      const year = base.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      date = { year, month, day: Math.min(base.day, daysInMonth(year, month)) };
    } else {
      date = addDays(base, index * (source.recurrence === 'WEEKLY' ? 7 : 14));
    }

    const start = fromLocalDateTime({ ...date, hour: base.hour, minute: base.minute }, timeZone);
    if (start.getTime() > source.recurrenceUntil.getTime()) {
      break;
    }
    occurrences.push({ start, end: new Date(start.getTime() + durationMs) });
  }

  return occurrences;
}

/** Occurrences overlapping [from, to), with cancelled ones removed. */
export function occurrencesInRange(
  source: RecurringSource,
  timeZone: string,
  range: { from: Date; to: Date },
  cancelledStarts: ReadonlySet<number> = new Set(),
): Occurrence[] {
  return allOccurrences(source, timeZone).filter(
    (occurrence) =>
      !cancelledStarts.has(occurrence.start.getTime()) &&
      occurrence.end.getTime() > range.from.getTime() &&
      occurrence.start.getTime() < range.to.getTime(),
  );
}

/** True if `start` is exactly one of the series' occurrence starts. */
export function isOccurrenceStart(source: RecurringSource, timeZone: string, start: Date): boolean {
  return allOccurrences(source, timeZone).some(
    (occurrence) => occurrence.start.getTime() === start.getTime(),
  );
}
