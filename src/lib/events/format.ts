import { toLocalDateTime, type LocalDate } from './time';
import type { MonthRef } from './calendar';

/** Display helpers: always the BDE timezone, never the server's or the browser's. */

const timeFormat = (locale: string, timeZone: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone });

function sameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const x = toLocalDateTime(a, timeZone);
  const y = toLocalDateTime(b, timeZone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function formatTime(date: Date, locale: string, timeZone: string): string {
  return timeFormat(locale, timeZone).format(date);
}

/** "20:00 – 23:00", or "20:00 → 11 oct., 02:00" when it ends on another day.
 * An end at exactly midnight still belongs to the previous day's evening. */
export function formatTimeRange(start: Date, end: Date, locale: string, timeZone: string): string {
  const startText = formatTime(start, locale, timeZone);
  const lastInstant = new Date(Math.max(end.getTime() - 1, start.getTime()));
  if (sameLocalDay(start, lastInstant, timeZone)) {
    return `${startText} – ${formatTime(end, locale, timeZone)}`;
  }
  const endDay = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(end);
  return `${startText} → ${endDay}, ${formatTime(end, locale, timeZone)}`;
}

/** "samedi 10 octobre 2026" */
export function formatLongDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone }).format(date);
}

/** Full date + time range for the detail page. */
export function formatDateTimeRange(
  start: Date,
  end: Date,
  locale: string,
  timeZone: string,
): string {
  return `${formatLongDate(start, locale, timeZone)}, ${formatTimeRange(start, end, locale, timeZone)}`;
}

/** A calendar day (no time) as a heading, e.g. "samedi 10 octobre". */
export function formatDayHeading(day: LocalDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

/** "octobre 2026", first letter capitalised. */
export function formatMonthTitle(ref: MonthRef, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ref.year, ref.month - 1, 1)));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** Monday-first weekday names ("lun.", "mar."…) for the calendar header. */
export function weekdayLabels(locale: string, width: 'short' | 'long' = 'short'): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
  // 1 Jan 2024 was a Monday.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index))),
  );
}
