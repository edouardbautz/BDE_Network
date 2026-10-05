import type { OccurrenceView } from './occurrences';
import { addDays, fromLocalDateTime, toLocalDateTime, type LocalDate } from './time';

export interface MonthRef {
  year: number;
  /** 1–12 */
  month: number;
}

export interface CalendarDay extends LocalDate {
  /** `YYYY-MM-DD` — the key occurrences are bucketed under. */
  key: string;
  inMonth: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

export const dayKey = (date: LocalDate): string =>
  `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;

export const monthKey = (ref: MonthRef): string => `${ref.year}-${pad(ref.month)}`;

/** Parses `YYYY-MM`; null when malformed or out of range. */
export function parseMonthKey(value: string | undefined): MonthRef | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100 ? { year, month } : null;
}

/** Parses `YYYY-MM-DD`; null when malformed or not a real date. */
export function parseDayKey(value: string | undefined): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return probe.getUTCMonth() === date.month - 1 && probe.getUTCDate() === date.day ? date : null;
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function currentMonth(now: Date, timeZone: string): MonthRef {
  const local = toLocalDateTime(now, timeZone);
  return { year: local.year, month: local.month };
}

export function today(now: Date, timeZone: string): LocalDate {
  const local = toLocalDateTime(now, timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

/** Monday = 0 … Sunday = 6 for a calendar date. */
function weekdayIndex(date: LocalDate): number {
  const sundayFirst = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** Weeks (Monday first) covering the month, padded with the neighbouring
 * months' days so every row has seven cells. */
export function buildMonthGrid(ref: MonthRef): CalendarDay[][] {
  const first: LocalDate = { year: ref.year, month: ref.month, day: 1 };
  let cursor = addDays(first, -weekdayIndex(first));
  const weeks: CalendarDay[][] = [];

  do {
    const week: CalendarDay[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push({ ...cursor, key: dayKey(cursor), inMonth: cursor.month === ref.month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.month === ref.month && cursor.year === ref.year);

  return weeks;
}

/** UTC range [from, to) spanning the whole grid, to query occurrences for. */
export function gridRange(grid: CalendarDay[][], timeZone: string): { from: Date; to: Date } {
  const firstDay = grid[0]?.[0];
  const lastDay = grid[grid.length - 1]?.[6];
  if (!firstDay || !lastDay) {
    throw new Error('Empty calendar grid');
  }
  const dayAfterLast = addDays(lastDay, 1);
  return {
    from: fromLocalDateTime({ ...firstDay, hour: 0, minute: 0 }, timeZone),
    to: fromLocalDateTime({ ...dayAfterLast, hour: 0, minute: 0 }, timeZone),
  };
}

/** Buckets occurrences under every local day they touch (a late-night event
 * running past midnight shows on both days). Order within a day is preserved. */
export function groupByLocalDay(
  occurrences: readonly OccurrenceView[],
  timeZone: string,
): Map<string, OccurrenceView[]> {
  const groups = new Map<string, OccurrenceView[]>();

  for (const occurrence of occurrences) {
    const startDay = toLocalDateTime(occurrence.start, timeZone);
    // An end at exactly 00:00 belongs to the previous day.
    const lastInstant = new Date(
      Math.max(occurrence.end.getTime() - 1, occurrence.start.getTime()),
    );
    const endDay = toLocalDateTime(lastInstant, timeZone);

    let cursor: LocalDate = { year: startDay.year, month: startDay.month, day: startDay.day };
    const lastKey = dayKey(endDay);

    // The loop is bounded: an occurrence cannot span more than a few days.
    for (let guard = 0; guard < 62; guard += 1) {
      const key = dayKey(cursor);
      const bucket = groups.get(key);
      if (bucket) bucket.push(occurrence);
      else groups.set(key, [occurrence]);
      if (key >= lastKey) break;
      cursor = addDays(cursor, 1);
    }
  }

  return groups;
}
