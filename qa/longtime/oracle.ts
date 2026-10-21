/**
 * What the long-time suite holds the reminder loop to, worked out WITHOUT the code under test: the moment a reminder becomes due
 * is read from the wall clock of the BDE with `Intl` alone (not `lib/events/time.ts`, which the loop uses), and the moment a
 * reminder is sent is the first tick of the loop that falls after it and before the date starts. Pure functions, tested on their
 * own (`oracle.test.ts`) on the changes of clock the suite crosses.
 */

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
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

/** What the wall clock of `timeZone` reads at this instant. */
export function wallClock(instant: Date, timeZone: string): Wall {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
  };
}

/** The wall clock as if it were UTC, in milliseconds: the difference with the instant is the offset of the zone. */
const asUtc = (wall: Wall) => Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

/** The instant at which the wall clock of `timeZone` reads that date and hour (a skipped hour is read one hour later). */
export function instantOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, 0);
  let instant = wanted;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = asUtc(wallClock(new Date(instant), timeZone)) - instant;
    instant = wanted - offset;
  }
  return new Date(instant);
}

/** `reminderHour`:00 on the wall clock, the day before the date starts. */
export function reminderDue(start: Date, timeZone: string, reminderHour: number): Date {
  const local = wallClock(start, timeZone);
  const dayBefore = new Date(Date.UTC(local.year, local.month - 1, local.day - 1));
  return instantOf(
    dayBefore.getUTCFullYear(),
    dayBefore.getUTCMonth() + 1,
    dayBefore.getUTCDate(),
    reminderHour,
    timeZone,
  );
}

/** The instants at which the loop looks, every `everyMs` from `from` (included) up to `to` (excluded). */
export function ticksBetween(from: Date, to: Date, everyMs: number): Date[] {
  const ticks: Date[] = [];
  for (let at = from.getTime(); at < to.getTime(); at += everyMs) ticks.push(new Date(at));
  return ticks;
}

export interface Occurrence {
  start: Date;
  /** Confirmed and not cancelled. */
  reminded: boolean;
  /** When its confirmation was announced, if it was. */
  announcedAt: Date | null;
}

/**
 * The tick at which the reminder of a date goes out, or null if it never does: the first tick at or after the moment it is due
 * and before the date starts; nothing for a date that is not confirmed or is cancelled, and nothing for one whose confirmation
 * was announced after the reminder was due (the members were just told about it).
 */
export function deliveryTick(
  occurrence: Occurrence,
  timeZone: string,
  reminderHour: number,
  ticks: readonly Date[],
): Date | null {
  if (!occurrence.reminded) return null;
  const due = reminderDue(occurrence.start, timeZone, reminderHour);
  if (occurrence.announcedAt && occurrence.announcedAt.getTime() > due.getTime()) return null;
  return (
    ticks.find(
      (tick) => tick.getTime() >= due.getTime() && tick.getTime() < occurrence.start.getTime(),
    ) ?? null
  );
}
