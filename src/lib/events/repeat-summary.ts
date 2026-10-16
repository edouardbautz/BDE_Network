import {
  WEEKDAYS,
  isRepeating,
  readRepeatRule,
  resolveRule,
  type RepeatRule,
  type Weekday,
} from './repeat';
import { toLocalDateTime, type LocalDate } from './time';

// The sentence that says a rule: "Every 2 weeks on Monday and Wednesday, 10 times". One function for the form, the page
// of an event, the page of the proposals and the notifications, so they never say it differently. The texts are the
// messages `events.repeat.summary.*`; the names of the days and months, and the way a list is joined, come from Intl.

export type RepeatTranslate = (key: string, values?: Record<string, string | number>) => string;

export interface RepeatSummaryInput {
  rule: RepeatRule;
  /** The day of the first date: what the rule leaves out is read from it. */
  first: LocalDate;
  /** The day the series ends on (shown unless the rule ends after N dates). */
  until: LocalDate;
}

/** What the sentence of an event that repeats is made from, or null for one that does not. */
export function summaryInputOf(
  event: { repeat?: unknown; startsAt: Date; recurrenceUntil: Date | null },
  timeZone: string,
): RepeatSummaryInput | null {
  const rule = readRepeatRule(event.repeat);
  if (!rule || !event.recurrenceUntil || !isRepeating(event)) return null;
  return {
    rule,
    first: toLocalDateTime(event.startsAt, timeZone),
    until: toLocalDateTime(event.recurrenceUntil, timeZone),
  };
}

const WORKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

/** A day of 2024, a year whose 1st of January was a Monday, to ask Intl for the name of a weekday or a month. */
export const weekdayName = (
  weekday: Weekday,
  locale: string,
  style: 'long' | 'short' = 'long',
): string =>
  new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(weekday))),
  );

export const monthName = (month: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, month - 1, 15)),
  );

const longDate = (date: LocalDate, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  );

/** "on the 15th", "on the 2nd Tuesday", "on the last Friday", "on the last day of the month"; in a yearly rule, "of March". */
export function patternText(
  rule: Pick<RepeatRule, 'freq' | 'monthly'>,
  first: LocalDate,
  t: RepeatTranslate,
  locale: string,
): string {
  const { monthly } = resolveRule({ ...rule, interval: 1 }, first);
  const yearly = rule.freq === 'YEARLY';
  const month = yearly ? monthName(first.month, locale) : '';
  // French says "d'octobre", "de mars": the message picks, the other languages ignore it
  const elide = /^[aeiouyhàâéèêëîïôùû]/i.test(month) ? 'yes' : 'no';
  const suffix = yearly ? 'OfMonth' : '';

  if (monthly.kind === 'day') {
    return yearly
      ? t('onDayOfMonth', { day: monthly.day, month })
      : t('onDay', { day: monthly.day });
  }
  if (monthly.kind === 'lastDay') return t(`onLastDay${suffix}`, { month, elide });

  const weekday = weekdayName(monthly.weekday, locale);
  return monthly.nth === -1
    ? t(`onLast${suffix}`, { weekday, month, elide })
    : t(`onNth${suffix}`, { nth: String(monthly.nth), weekday, month, elide });
}

/** The rule, in a sentence, with how it ends. */
export function summarizeRepeat(
  { rule, first, until }: RepeatSummaryInput,
  t: RepeatTranslate,
  locale: string,
): string {
  return `${describeRepeat(rule, first, t, locale)}${
    rule.count === undefined
      ? t('until', { date: longDate(until, locale) })
      : t('times', { count: rule.count })
  }`;
}

/** The rule alone, without how it ends: "Every week on Monday". It is also what the choices of the list say. */
export function describeRepeat(
  rule: RepeatRule,
  first: LocalDate,
  t: RepeatTranslate,
  locale: string,
): string {
  const every = rule.interval === 1;
  const count = rule.interval;
  let base: string;

  if (rule.freq === 'DAILY') {
    base = every ? t('daily') : t('dailyEvery', { count });
  } else if (rule.freq === 'WEEKLY') {
    const weekdays = resolveRule(rule, first).weekdays;
    const isWorkweek =
      weekdays.length === WORKDAYS.length && WORKDAYS.every((day) => weekdays.includes(day));
    if (isWorkweek && every) {
      base = t('weekdays');
    } else {
      const days = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
        weekdays.map((weekday) => t('onWeekday', { day: weekdayName(weekday, locale) })),
      );
      base = every ? t('weekly', { days }) : t('weeklyEvery', { count, days });
    }
  } else {
    const on = patternText(rule, first, t, locale);
    const key = rule.freq === 'MONTHLY' ? 'monthly' : 'yearly';
    base = every ? t(key, { on }) : t(`${key}Every`, { count, on });
  }

  return base;
}
