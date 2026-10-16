import {
  MAX_OCCURRENCES,
  REPEAT_FREQUENCIES,
  WEEKDAYS,
  alignStart,
  endOfCountedRule,
  expandRepeat,
  normalizeRule,
  resolveRule,
  sameRepeat,
  weekdayOf,
  type MonthlyPattern,
  type RepeatFrequency,
  type RepeatRule,
  type Weekday,
} from './repeat';
import { fromLocalDateTime, parseLocalDateInput, type LocalDate } from './time';

// What the repeat part of the event form says, and how it becomes a rule. Pure (no server-only import): the form runs
// it in the browser to show the errors and the next dates before sending, and the server actions run the very same
// code again — the browser is never trusted. The choices of the list ("every week on Monday", "every month on the
// 2nd Tuesday"…) are worked out from the first date; "Custom" says everything.

/** The choices of the list, in the order it shows them. */
export const REPEAT_PRESETS = [
  'NONE',
  'DAILY',
  'WEEKDAYS',
  'WEEKLY',
  'MONTHLY',
  'MONTHLY_NTH',
  'YEARLY',
  'CUSTOM',
] as const;
export type RepeatPreset = (typeof REPEAT_PRESETS)[number];

/** Which day of the month a custom monthly or yearly rule falls on, as the form asks it. */
export const MONTHLY_CHOICES = ['day', 'nth', 'last', 'lastDay'] as const;
export type MonthlyChoice = (typeof MONTHLY_CHOICES)[number];

export const REPEAT_ENDS = ['until', 'count'] as const;
export type RepeatEnd = (typeof REPEAT_ENDS)[number];

/** The most an interval can be ("every 99 weeks"). */
export const MAX_INTERVAL = 99;

/** The repeat fields of the form, as submitted: all strings (the weekdays a list of them). */
export interface RawRepeat {
  /** A `RepeatPreset`. */
  repeat: string;
  /** A custom rule: `RepeatFrequency`, every N, which weekdays. */
  repeatFreq: string;
  repeatInterval: string;
  repeatWeekdays: string[];
  /** A `MonthlyChoice`, and for "on the 15th" which day (empty: the day of the first date). */
  repeatMonthly: string;
  repeatMonthDay: string;
  /** How the series ends: a `RepeatEnd`, then the date (`YYYY-MM-DD`) or the number of dates. */
  repeatEnd: string;
  recurrenceUntil: string;
  repeatCount: string;
}

export const NO_REPEAT: RawRepeat = {
  repeat: 'NONE',
  repeatFreq: 'WEEKLY',
  repeatInterval: '1',
  repeatWeekdays: [],
  repeatMonthly: 'day',
  repeatMonthDay: '',
  repeatEnd: 'until',
  recurrenceUntil: '',
  repeatCount: '10',
};

/** The fields of the form that carry an error, and the codes (keys of `events.form.errors.*`). */
export type RepeatField =
  | 'repeat'
  | 'repeatInterval'
  | 'repeatWeekdays'
  | 'repeatMonthly'
  | 'repeatCount'
  | 'recurrenceUntil';
export type RepeatErrorCode =
  | 'invalid'
  | 'untilRequired'
  | 'intervalInvalid'
  | 'weekdaysRequired'
  | 'countInvalid'
  | 'monthlyUnavailable'
  | 'untilBeforeStart'
  | 'tooManyOccurrences';

export type RepeatErrors = Partial<Record<RepeatField, RepeatErrorCode>>;

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

const WORKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

function daysInMonth(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();
}

/** Which weekday of its month a date is: 1 for the first Tuesday… 5 for a fifth one (which not every month has). */
export function ordinalOfWeekday(date: LocalDate): number {
  return Math.ceil(date.day / 7);
}

export const isLastWeekdayOfMonth = (date: LocalDate): boolean => date.day + 7 > daysInMonth(date);
export const isLastDayOfMonth = (date: LocalDate): boolean => date.day === daysInMonth(date);

/**
 * The pattern of a monthly or yearly rule for a choice of the form, from the first date: a day (the one of the first
 * date unless `day` says another: a series cut on the 28th of February is still on the 31st), its place in the month
 * for its weekday ("the 2nd Tuesday"; a 5th has none: that is "the last"), the last of its weekday, or the last day of
 * the month. null: the choice does not exist for this date.
 */
export function monthlyPatternOf(
  choice: MonthlyChoice,
  first: LocalDate,
  day: number = first.day,
): MonthlyPattern | null {
  switch (choice) {
    case 'day':
      return { kind: 'day', day };
    case 'lastDay':
      return { kind: 'lastDay' };
    case 'last':
      return { kind: 'nth', nth: -1, weekday: weekdayOf(first) };
    case 'nth': {
      const nth = ordinalOfWeekday(first);
      return nth <= 4
        ? { kind: 'nth', nth: nth as 1 | 2 | 3 | 4, weekday: weekdayOf(first) }
        : null;
    }
  }
}

/** The rule of a choice of the list, from the first date (null: the event does not repeat). */
export function presetRule(preset: RepeatPreset, first: LocalDate): RepeatRule | null {
  switch (preset) {
    case 'NONE':
    case 'CUSTOM':
      return null;
    case 'DAILY':
      return { freq: 'DAILY', interval: 1 };
    case 'WEEKDAYS':
      return { freq: 'WEEKLY', interval: 1, weekdays: WORKDAYS };
    // These follow the first date (no weekday or day written): moving it moves the series.
    case 'WEEKLY':
      return { freq: 'WEEKLY', interval: 1 };
    case 'MONTHLY':
      return { freq: 'MONTHLY', interval: 1 };
    case 'YEARLY':
      return { freq: 'YEARLY', interval: 1 };
    case 'MONTHLY_NTH':
      return {
        freq: 'MONTHLY',
        interval: 1,
        // the 5th does not exist every month: the last one does
        monthly: monthlyPatternOf('nth', first) ?? monthlyPatternOf('last', first)!,
      };
  }
}

/** The choice of the list that a stored rule is, from its first date: `CUSTOM` when it is none of them. */
export function presetOf(rule: RepeatRule | null, first: LocalDate): RepeatPreset {
  if (!rule) return 'NONE';
  for (const preset of REPEAT_PRESETS) {
    const candidate = presetRule(preset, first);
    if (candidate && sameRepeat({ ...rule, count: undefined }, candidate, first)) return preset;
  }
  return 'CUSTOM';
}

/** Which radio of a custom monthly or yearly rule a stored pattern is. */
function monthlyChoiceOf(rule: RepeatRule, first: LocalDate): MonthlyChoice {
  const { monthly } = resolveRule(rule, first);
  if (monthly.kind === 'lastDay') return 'lastDay';
  if (monthly.kind === 'day') return 'day';
  return monthly.nth === -1 ? 'last' : 'nth';
}

/** The repeat fields of the form for what is stored: the rule, and the end date (`untilDay`, `YYYY-MM-DD`). */
export function rawRepeatOf(
  rule: RepeatRule | null,
  first: LocalDate,
  untilDay: string,
): RawRepeat {
  if (!rule) return { ...NO_REPEAT };
  const resolved = resolveRule(rule, first);
  const hasPattern = rule.freq === 'MONTHLY' || rule.freq === 'YEARLY';
  return {
    repeat: presetOf(rule, first),
    repeatFreq: rule.freq,
    repeatInterval: String(rule.interval),
    repeatWeekdays: [...resolved.weekdays],
    repeatMonthly: hasPattern ? monthlyChoiceOf(rule, first) : 'day',
    repeatMonthDay: resolved.monthly.kind === 'day' ? String(resolved.monthly.day) : '',
    repeatEnd: rule.count === undefined ? 'until' : 'count',
    recurrenceUntil: rule.count === undefined ? untilDay : '',
    repeatCount: rule.count === undefined ? '10' : String(rule.count),
  };
}

export type ParsedRepeat =
  | {
      ok: true;
      /** null: the event does not repeat. */
      rule: RepeatRule | null;
      /** The day the series ends on, when it ends on a date. */
      untilDay: LocalDate | null;
    }
  | { ok: false; errors: RepeatErrors };

/** A whole number written with digits only, between `min` and `max`: anything else is not one. */
function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

/**
 * Reads the repeat fields of the form. `first` is the day of the first date (null when it is not valid: what depends on
 * it waits). Nothing that does not matter for the choice made is read: a custom frequency typed and then abandoned for
 * "Does not repeat" is ignored.
 */
export function parseRepeatInput(raw: RawRepeat, first: LocalDate | null): ParsedRepeat {
  if (!isOneOf(REPEAT_PRESETS, raw.repeat)) return { ok: false, errors: { repeat: 'invalid' } };
  if (raw.repeat === 'NONE') return { ok: true, rule: null, untilDay: null };

  const errors: RepeatErrors = {};
  let rule: RepeatRule | null = null;

  if (raw.repeat === 'CUSTOM') {
    const freq: RepeatFrequency | null = isOneOf(REPEAT_FREQUENCIES, raw.repeatFreq)
      ? raw.repeatFreq
      : null;
    const interval = wholeNumber(raw.repeatInterval, 1, MAX_INTERVAL);
    if (!freq) errors.repeat = 'invalid';
    if (interval === null) errors.repeatInterval = 'intervalInvalid';

    if (freq && interval !== null) {
      rule = { freq, interval };
      if (freq === 'WEEKLY') {
        const weekdays = raw.repeatWeekdays.filter((day): day is Weekday =>
          (WEEKDAYS as readonly string[]).includes(day),
        );
        if (weekdays.length === 0 || weekdays.length !== raw.repeatWeekdays.length) {
          errors.repeatWeekdays = 'weekdaysRequired';
        } else {
          rule.weekdays = weekdays;
        }
      }
      if (freq === 'MONTHLY' || freq === 'YEARLY') {
        if (!isOneOf(MONTHLY_CHOICES, raw.repeatMonthly)) {
          errors.repeatMonthly = 'invalid';
        } else if (first) {
          const day =
            raw.repeatMonthDay === '' ? first.day : wholeNumber(raw.repeatMonthDay, 1, 31);
          const monthly = day === null ? null : monthlyPatternOf(raw.repeatMonthly, first, day);
          if (monthly) rule.monthly = monthly;
          else errors.repeatMonthly = day === null ? 'invalid' : 'monthlyUnavailable';
        }
      }
    }
  } else if (first) {
    rule = presetRule(raw.repeat, first);
  } else {
    rule = { freq: 'WEEKLY', interval: 1 }; // checked again once the first date is valid
  }

  let untilDay: LocalDate | null = null;
  if (!isOneOf(REPEAT_ENDS, raw.repeatEnd)) {
    errors.recurrenceUntil = 'invalid';
  } else if (raw.repeatEnd === 'count') {
    const count = wholeNumber(raw.repeatCount, 1, MAX_OCCURRENCES);
    if (count === null) errors.repeatCount = 'countInvalid';
    else if (rule) rule.count = count;
  } else if (!raw.recurrenceUntil) {
    errors.recurrenceUntil = 'untilRequired';
  } else {
    untilDay = parseLocalDateInput(raw.recurrenceUntil);
    if (!untilDay) errors.recurrenceUntil = 'invalid';
  }

  if (Object.keys(errors).length > 0 || !rule) return { ok: false, errors };
  return { ok: true, rule: normalizeRule(rule), untilDay };
}

export type RepeatPlan =
  | {
      ok: true;
      /** null: the event does not repeat. */
      rule: RepeatRule | null;
      /** The first date: the one typed, or the first that fits the rule. */
      startsAt: Date;
      endsAt: Date;
      /** When the series ends (see `Event.recurrenceUntil`); null exactly when there is no rule. */
      recurrenceUntil: Date | null;
    }
  | { ok: false; errors: RepeatErrors };

/**
 * What the repeat fields of the form make of the first date typed: the rule, the first date (a Tuesday, with "Monday
 * and Wednesday", is a Wednesday), and when the series ends. The one place the end of a series is worked out: the
 * server saves it, the form shows the dates it gives.
 */
export function planRepeat(
  raw: RawRepeat,
  first: { startsAt: Date; endsAt: Date; startLocal: LocalDate },
  timeZone: string,
): RepeatPlan {
  const parsed = parseRepeatInput(raw, first.startLocal);
  if (!parsed.ok) return parsed;
  const { rule, untilDay } = parsed;
  if (!rule) return { ok: true, rule: null, ...first, recurrenceUntil: null };

  const aligned = alignStart(rule, first.startsAt, first.endsAt, timeZone);
  // An end date is inclusive: a date starting that day still counts. A series that ends after N dates ends where its
  // last one starts.
  const recurrenceUntil = untilDay
    ? fromLocalDateTime({ ...untilDay, hour: 23, minute: 59 }, timeZone)
    : endOfCountedRule(rule, aligned.startsAt, aligned.endsAt, timeZone);
  if (!recurrenceUntil || recurrenceUntil.getTime() < aligned.startsAt.getTime()) {
    return { ok: false, errors: { recurrenceUntil: 'untilBeforeStart' } };
  }
  const { truncated } = expandRepeat({ ...aligned, repeat: rule, recurrenceUntil }, timeZone);
  if (truncated) return { ok: false, errors: { recurrenceUntil: 'tooManyOccurrences' } };

  return { ok: true, rule, ...aligned, recurrenceUntil };
}
