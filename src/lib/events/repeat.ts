import '../zod-config';
import { z } from 'zod';
import { fromLocalDateTime, toLocalDateTime, type LocalDate } from './time';

// The repeat rules of an event: what the form lets a person say, what is stored in `Event.repeat`, and the dates it
// produces. Pure, without any date library: the dates are worked out on the wall clock of the BDE's time zone, so a
// "every Monday at 6 pm" stays at 6 pm across the changes of hour. See "Repeat rules" in docs/architecture.md.

/** Most dates one event (one row) holds: a year of "every day" fits. A longer series is cut in two. */
export const MAX_OCCURRENCES = 400;

/** Monday first: the week of a rule that repeats "every 2 weeks" starts on a Monday (the French way). */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const REPEAT_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type RepeatFrequency = (typeof REPEAT_FREQUENCIES)[number];

/** The ordinals offered for "the Nth weekday of the month": the 5th does not exist every month, so there is "last". */
export const NTH_VALUES = [1, 2, 3, 4, -1] as const;
export type Nth = (typeof NTH_VALUES)[number];

/** Which day of the month (or, for a yearly rule, of the month of the first date) a rule falls on. */
export type MonthlyPattern =
  { kind: 'day'; day: number } | { kind: 'lastDay' } | { kind: 'nth'; nth: Nth; weekday: Weekday };

/**
 * A repeat rule, as stored. What is left out means "like the first date": no `weekdays` is the weekday of the first
 * date, no `monthly` is its day of the month (a day a short month does not have falls on the last day of that
 * month). How the series ends is not here: an end date is `Event.recurrenceUntil`, and so is the end of a rule with
 * a `count` (the start of its last date, worked out when it is saved, so the database can filter on it).
 */
export interface RepeatRule {
  freq: RepeatFrequency;
  /** Every `interval` days, weeks, months or years. */
  interval: number;
  weekdays?: Weekday[];
  monthly?: MonthlyPattern;
  /** The series ends after this many dates. */
  count?: number;
}

const weekdaySchema = z.enum(WEEKDAYS);

const monthlySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('day'), day: z.number().int().min(1).max(31) }).strict(),
  z.object({ kind: z.literal('lastDay') }).strict(),
  z
    .object({
      kind: z.literal('nth'),
      nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]),
      weekday: weekdaySchema,
    })
    .strict(),
]);

export const repeatRuleSchema = z
  .object({
    freq: z.enum(REPEAT_FREQUENCIES),
    interval: z.number().int().min(1).max(99),
    weekdays: z.array(weekdaySchema).min(1).max(7).optional(),
    monthly: monthlySchema.optional(),
    count: z.number().int().min(1).max(MAX_OCCURRENCES).optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.weekdays && rule.freq !== 'WEEKLY') {
      context.addIssue({
        code: 'custom',
        path: ['weekdays'],
        message: 'only a weekly rule has weekdays',
      });
    }
    if (rule.monthly && rule.freq !== 'MONTHLY' && rule.freq !== 'YEARLY') {
      context.addIssue({
        code: 'custom',
        path: ['monthly'],
        message: 'only a monthly or yearly rule has a day',
      });
    }
  });

/** The weekdays in the order of the week, each once. */
function sortedWeekdays(weekdays: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((weekday) => weekdays.includes(weekday));
}

/** The rule in its one written form: weekdays sorted and unique, nothing that does not belong to its frequency. */
export function normalizeRule(rule: RepeatRule): RepeatRule {
  return {
    freq: rule.freq,
    interval: rule.interval,
    ...(rule.freq === 'WEEKLY' && rule.weekdays ? { weekdays: sortedWeekdays(rule.weekdays) } : {}),
    ...((rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') && rule.monthly
      ? { monthly: rule.monthly }
      : {}),
    ...(rule.count !== undefined ? { count: rule.count } : {}),
  };
}

const parsed = new WeakMap<object, RepeatRule | null>();

/**
 * The rule stored in `Event.repeat`, or null when there is none (an event that does not repeat) or when what is
 * there is not a rule (it is never trusted: a damaged value is an event that does not repeat, not a crash).
 */
export function readRepeatRule(value: unknown): RepeatRule | null {
  if (typeof value !== 'object' || value === null) return null;
  const known = parsed.get(value);
  if (known !== undefined) return known;
  const result = repeatRuleSchema.safeParse(value);
  const rule = result.success ? normalizeRule(result.data) : null;
  parsed.set(value, rule);
  return rule;
}

// ---- the dates ------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const epochDay = (date: LocalDate): number =>
  Math.floor(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);

function fromEpochDay(day: number): LocalDate {
  const date = new Date(day * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** 0 for Monday … 6 for Sunday (1970-01-01, day 0, was a Thursday). */
const mondayIndex = (day: number): number => (((day + 3) % 7) + 7) % 7;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The weekday of a date, as the rules write it. */
export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[mondayIndex(epochDay(date))]!;
}

/** The day of the month the pattern falls on in this month: a day the month does not have is its last day. */
function dayInMonth(year: number, month: number, pattern: MonthlyPattern): number {
  const length = daysInMonth(year, month);
  if (pattern.kind === 'day') return Math.min(pattern.day, length);
  if (pattern.kind === 'lastDay') return length;

  const wanted = WEEKDAYS.indexOf(pattern.weekday);
  if (pattern.nth === -1) {
    const lastIndex = mondayIndex(epochDay({ year, month, day: length }));
    return length - ((lastIndex - wanted + 7) % 7);
  }
  const firstIndex = mondayIndex(epochDay({ year, month, day: 1 }));
  // The 4th at the latest: it exists in every month (the 5th does not).
  return 1 + ((wanted - firstIndex + 7) % 7) + 7 * (pattern.nth - 1);
}

/** The rule with every "like the first date" filled in from the first date. */
export interface ResolvedRule {
  freq: RepeatFrequency;
  interval: number;
  weekdays: Weekday[];
  monthly: MonthlyPattern;
  count: number | null;
}

export function resolveRule(rule: RepeatRule, first: LocalDate): ResolvedRule {
  return {
    freq: rule.freq,
    interval: rule.interval,
    weekdays: sortedWeekdays(rule.weekdays ?? [weekdayOf(first)]),
    monthly: rule.monthly ?? { kind: 'day', day: first.day },
    count: rule.count ?? null,
  };
}

/** The calendar days of the rule, in order, from `first` on and for ever (the caller stops it). */
function* calendarDays(rule: ResolvedRule, first: LocalDate): Generator<LocalDate> {
  const firstDay = epochDay(first);

  if (rule.freq === 'DAILY') {
    for (let day = firstDay; ; day += rule.interval) yield fromEpochDay(day);
  }

  if (rule.freq === 'WEEKLY') {
    const weekStart = firstDay - mondayIndex(firstDay);
    const offsets = rule.weekdays.map((weekday) => WEEKDAYS.indexOf(weekday));
    for (let week = 0; ; week += 1) {
      for (const offset of offsets) {
        const day = weekStart + week * rule.interval * 7 + offset;
        // The week of the first date may hold days before it.
        if (day >= firstDay) yield fromEpochDay(day);
      }
    }
  }

  if (rule.freq === 'MONTHLY') {
    const firstMonth = first.year * 12 + first.month - 1;
    for (let step = 0; ; step += 1) {
      const monthIndex = firstMonth + step * rule.interval;
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const date = { year, month, day: dayInMonth(year, month, rule.monthly) };
      if (epochDay(date) >= firstDay) yield date;
    }
  }

  for (let step = 0; ; step += 1) {
    const year = first.year + step * rule.interval;
    const date = { year, month: first.month, day: dayInMonth(year, first.month, rule.monthly) };
    if (epochDay(date) >= firstDay) yield date;
  }
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Whether two rules give the same dates from this first date, whatever each leaves out ("like the first date"):
 * the number of dates counts, the end date does not (it is not in the rule). A rule that repeats and one that does not
 * are never the same.
 */
export function sameRepeat(a: RepeatRule | null, b: RepeatRule | null, first: LocalDate): boolean {
  if (a === null || b === null) return a === b;
  const x = resolveRule(a, first);
  const y = resolveRule(b, first);
  return (
    x.freq === y.freq &&
    x.interval === y.interval &&
    x.count === y.count &&
    sameList(x.weekdays, y.weekdays) &&
    JSON.stringify(x.monthly) === JSON.stringify(y.monthly)
  );
}

/** Whether an event repeats: it has a rule and a date it ends on (a series always has both). */
export function isRepeating(event: { repeat?: unknown; recurrenceUntil: Date | null }): boolean {
  return event.recurrenceUntil !== null && readRepeatRule(event.repeat) !== null;
}

/**
 * The rules of the two rows a series is cut in, at its date number `index` (1 or more) from the first date `first`:
 * `head` gives the dates before it, `tail` the dates from it on, from where it starts. What the rule leaves out is
 * "like the first date", which is no longer the same date for the tail: a day of the month it gives is written, so
 * that the 31st stays the 31st after a cut on the 28th of February. A series that ends after N dates shares them:
 * `index` for the head, the others for the tail.
 */
export function cutRule(
  rule: RepeatRule,
  first: LocalDate,
  index: number,
): { head: RepeatRule; tail: RepeatRule } {
  const head: RepeatRule = { ...rule, ...(rule.count !== undefined ? { count: index } : {}) };
  const tail: RepeatRule = {
    ...rule,
    ...((rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') && !rule.monthly
      ? { monthly: { kind: 'day' as const, day: first.day } }
      : {}),
    ...(rule.count !== undefined ? { count: rule.count - index } : {}),
  };
  return { head: normalizeRule(head), tail: normalizeRule(tail) };
}

export interface RecurringSource {
  startsAt: Date;
  endsAt: Date;
  /** The value of `Event.repeat`: read with `readRepeatRule`. */
  repeat?: unknown;
  /** The instant after which no date starts. null: the event does not repeat. */
  recurrenceUntil: Date | null;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

export interface Expansion {
  occurrences: Occurrence[];
  /** The rule has more dates than an event holds (`MAX_OCCURRENCES`): it was cut short. */
  truncated: boolean;
}

/**
 * Every date of an event, with its end, in order: the start of each is the wall clock of the first date on the
 * day the rule says (so the hour does not move at a change of hour). Stops at `recurrenceUntil` (inclusive), after
 * `count` dates, or at `MAX_OCCURRENCES`, whichever comes first.
 */
export function expandRepeat(source: RecurringSource, timeZone: string): Expansion {
  const rule = readRepeatRule(source.repeat);
  if (!rule || !source.recurrenceUntil) {
    return { occurrences: [{ start: source.startsAt, end: source.endsAt }], truncated: false };
  }

  const durationMs = source.endsAt.getTime() - source.startsAt.getTime();
  const base = toLocalDateTime(source.startsAt, timeZone);
  const resolved = resolveRule(rule, base);
  const limit = resolved.count ?? Infinity;
  const occurrences: Occurrence[] = [];

  for (const day of calendarDays(resolved, base)) {
    if (occurrences.length >= limit) break;
    const start = fromLocalDateTime({ ...day, hour: base.hour, minute: base.minute }, timeZone);
    if (start.getTime() > source.recurrenceUntil.getTime()) break;
    if (occurrences.length >= MAX_OCCURRENCES) return { occurrences, truncated: true };
    occurrences.push({ start, end: new Date(start.getTime() + durationMs) });
  }

  return { occurrences, truncated: false };
}

/**
 * The first date of a rule from a first date typed: the day itself when it fits the rule (the usual case, the forms
 * start from the first date), otherwise the first day that does (a Tuesday with "Monday and Wednesday" starts on the
 * Wednesday). Same hour of the wall clock.
 */
export function alignStart(
  rule: RepeatRule,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const base = toLocalDateTime(startsAt, timeZone);
  const [first] = calendarDays(resolveRule(rule, base), base);
  if (!first || epochDay(first) === epochDay(base)) return { startsAt, endsAt };
  const aligned = fromLocalDateTime({ ...first, hour: base.hour, minute: base.minute }, timeZone);
  return {
    startsAt: aligned,
    endsAt: new Date(aligned.getTime() + (endsAt.getTime() - startsAt.getTime())),
  };
}

/**
 * When a rule that ends after `count` dates ends: the start of its last date (the database filters on it). Worked
 * out from the dates themselves, so it is always where the dates stop.
 */
export function endOfCountedRule(
  rule: RepeatRule,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): Date | null {
  if (rule.count === undefined) return null;
  // `recurrenceUntil` far away: the count is what stops the dates.
  const { occurrences } = expandRepeat(
    { startsAt, endsAt, repeat: rule, recurrenceUntil: new Date(8.64e15) },
    timeZone,
  );
  return occurrences.at(-1)?.start ?? null;
}
