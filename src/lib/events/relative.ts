import { toLocalDateTime } from './time';

const DAY_MS = 86_400_000;

/**
 * How many calendar days from `now` to `date` on the wall clock of `timeZone`: 0 for today, 1 for tomorrow, negative for a
 * day that has passed. Calendar days, not 24-hour spans: 23:30 tonight is "today", 00:10 tomorrow is "tomorrow".
 */
export function daysFromToday(date: Date, now: Date, timeZone: string): number {
  const day = toLocalDateTime(date, timeZone);
  const today = toLocalDateTime(now, timeZone);
  return Math.round(
    (Date.UTC(day.year, day.month - 1, day.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
      DAY_MS,
  );
}
