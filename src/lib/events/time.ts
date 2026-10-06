/**
 * Time-zone helpers built on Intl only (no date library). Events are stored in
 * UTC; everything the user sees or types is a "wall clock" time in the BDE
 * timezone (bde.timezone). These helpers convert between the two.
 */

export interface LocalDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading of `date` in `timeZone`. */
export function toLocalDateTime(date: Date, timeZone: string): LocalDateTime {
  const parts = new Map<string, number>();
  for (const part of getFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') {
      parts.set(part.type, Number(part.value));
    }
  }
  const read = (type: string) => parts.get(type) ?? 0;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

/** Offset of `timeZone` from UTC at the instant `utcMs`, in milliseconds. */
function offsetAt(utcMs: number, timeZone: string): number {
  const local = toLocalDateTime(new Date(utcMs), timeZone);
  const wallAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // The formatter only resolves minutes: compare against the instant truncated to the minute.
  return wallAsUtc - Math.floor(utcMs / 60_000) * 60_000;
}

/**
 * The UTC instant at which a wall clock in `timeZone` reads `local`.
 * Around DST changes: a time that does not exist (spring forward) resolves to
 * the instant one hour later on the clock; a time that happens twice (fall
 * back) resolves to its second occurrence.
 */
export function fromLocalDateTime(local: LocalDateTime, timeZone: string): Date {
  const wallAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const firstGuess = wallAsUtc - offsetAt(wallAsUtc, timeZone);
  const secondGuess = wallAsUtc - offsetAt(firstGuess, timeZone);
  return new Date(secondGuess);
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `YYYY-MM-DDTHH:mm`, the value format of an `<input type="datetime-local">`. */
export function formatLocalInput(date: Date, timeZone: string): string {
  const l = toLocalDateTime(date, timeZone);
  return `${pad(l.year, 4)}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
}

/** `YYYY-MM-DD`, the value format of an `<input type="date">`. */
export function formatLocalDateInput(date: Date, timeZone: string): string {
  return formatLocalInput(date, timeZone).slice(0, 10);
}

const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Parses a `datetime-local` value; null if malformed or not a real date. */
export function parseLocalInput(value: string): LocalDateTime | null {
  const match = DATETIME_PATTERN.exec(value);
  if (!match) return null;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0] = match.slice(1).map(Number);
  if (!isRealCalendarDate(year, month, day) || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

/** Parses a `date` input value; null if malformed or not a real date. */
export function parseLocalDateInput(value: string): LocalDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year = 0, month = 0, day = 0] = match.slice(1).map(Number);
  return isRealCalendarDate(year, month, day) ? { year, month, day } : null;
}

/** Academic year of an instant: September–August, e.g. "2025-2026" for any
 * date from 1 Sep 2025 to 31 Aug 2026 (in the given timezone). */
export function schoolYearOf(date: Date, timeZone: string): string {
  const { year, month } = toLocalDateTime(date, timeZone);
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

/** Calendar-day arithmetic on a wall-clock date, independent of any DST. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Whether two instants fall on the same calendar day on the BDE's wall clock. */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const [x, y] = [toLocalDateTime(a, timeZone), toLocalDateTime(b, timeZone)];
  return x.year === y.year && x.month === y.month && x.day === y.day;
}
