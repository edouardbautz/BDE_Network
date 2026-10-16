import { dayKey, parseDayKey } from './calendar';
import {
  addDays,
  formatLocalInput,
  fromLocalDateTime,
  toLocalDateTime,
  type LocalDate,
} from './time';

/**
 * What a new event starts from: 18:00 to 20:00 (BDE time zone), the usual evening of a student association. It is a
 * plausible starting point that is quick to adjust, instead of an empty date picker.
 */
export const DEFAULT_START_HOUR = 18;
export const DEFAULT_END_HOUR = 20;

/** Years the quick-add links are willing to start from: anything else in the address is somebody typing. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * The day asked for in `/events/new?date=YYYY-MM-DD` (the "+" of the calendar). `null` for anything that is not a real
 * date of a sensible year: the form then starts from tomorrow, as when it is opened from the button.
 */
export function requestedEventDay(value: string | string[] | undefined): LocalDate | null {
  const day = parseDayKey(Array.isArray(value) ? value[0] : value);
  return day && day.year >= MIN_YEAR && day.year <= MAX_YEAR ? day : null;
}

/** The start and end of a new event in the format of the form's fields, on `day` or, without one, tomorrow. */
export function defaultEventTimes(now: Date, timeZone: string, day: LocalDate | null) {
  const date = day ?? addDays(toLocalDateTime(now, timeZone), 1);
  const start = fromLocalDateTime({ ...date, hour: DEFAULT_START_HOUR, minute: 0 }, timeZone);
  const end = fromLocalDateTime({ ...date, hour: DEFAULT_END_HOUR, minute: 0 }, timeZone);
  return { startsAt: formatLocalInput(start, timeZone), endsAt: formatLocalInput(end, timeZone) };
}

/** Where "Cancel" of the form leads back to: the day of the calendar it was opened from, or the plain list. */
export function cancelHrefFor(day: LocalDate | null): string {
  if (!day) return '/events';
  const month = `${day.year}-${String(day.month).padStart(2, '0')}`;
  return `/events?view=calendar&month=${month}&day=${dayKey(day)}`;
}
