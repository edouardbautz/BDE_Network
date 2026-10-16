import { describe, expect, it, vi } from 'vitest';
import {
  MAX_OCCURRENCES,
  WEEKDAYS,
  alignStart,
  endOfCountedRule,
  expandRepeat,
  isRepeating,
  normalizeRule,
  readRepeatRule,
  resolveRule,
  sameRepeat,
  weekdayOf,
  type MonthlyPattern,
  type RepeatRule,
  type Weekday,
} from './repeat';
import { addDays, formatLocalInput, fromLocalDateTime, toLocalDateTime } from './time';

// A few tests play thousands of random series: a slow runner (Windows in CI) needs more than 5 seconds.
vi.setConfig({ testTimeout: 60_000 });

const PARIS = 'Europe/Paris';

/** An event that starts at a wall clock of `zone` and repeats by `rule` until the end of the day `until`. */
function series(
  rule: RepeatRule | null,
  start: string,
  until: string | null,
  options: { zone?: string; hours?: number } = {},
) {
  const zone = options.zone ?? PARIS;
  const [date, time = '18:00'] = start.split('T');
  const [year, month, day] = date!.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const startsAt = fromLocalDateTime(
    { year: year!, month: month!, day: day!, hour: hour!, minute: minute! },
    zone,
  );
  const [uy, um, ud] = (until ?? '2100-01-01').split('-').map(Number);
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + (options.hours ?? 2) * 3_600_000),
    repeat: rule,
    recurrenceUntil: until
      ? fromLocalDateTime({ year: uy!, month: um!, day: ud!, hour: 23, minute: 59 }, zone)
      : null,
    zone,
  };
}

/** The dates of a rule as `YYYY-MM-DD`, in the zone of the series. */
function days(source: ReturnType<typeof series>): string[] {
  return expandRepeat(source, source.zone).occurrences.map((o) =>
    formatLocalInput(o.start, source.zone).slice(0, 10),
  );
}

const weekly = (weekdays?: Weekday[], interval = 1, count?: number): RepeatRule => ({
  freq: 'WEEKLY',
  interval,
  ...(weekdays ? { weekdays } : {}),
  ...(count ? { count } : {}),
});
const monthly = (monthlyPattern?: MonthlyPattern, interval = 1, count?: number): RepeatRule => ({
  freq: 'MONTHLY',
  interval,
  ...(monthlyPattern ? { monthly: monthlyPattern } : {}),
  ...(count ? { count } : {}),
});
const yearly = (monthlyPattern?: MonthlyPattern, interval = 1, count?: number): RepeatRule => ({
  freq: 'YEARLY',
  interval,
  ...(monthlyPattern ? { monthly: monthlyPattern } : {}),
  ...(count ? { count } : {}),
});

describe('every day, every N days', () => {
  it('repeats every day up to and including the last day', () => {
    expect(days(series({ freq: 'DAILY', interval: 1 }, '2026-10-01', '2026-10-04'))).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('repeats every N days', () => {
    expect(days(series({ freq: 'DAILY', interval: 3 }, '2026-10-01', '2026-10-12'))).toEqual([
      '2026-10-01',
      '2026-10-04',
      '2026-10-07',
      '2026-10-10',
    ]);
  });

  it('rolls over the end of a month and of a year, and over a leap day', () => {
    expect(days(series({ freq: 'DAILY', interval: 1 }, '2027-12-30', '2028-01-02'))).toEqual([
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
      '2028-01-02',
    ]);
    expect(days(series({ freq: 'DAILY', interval: 1 }, '2028-02-28', '2028-03-01'))).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });
});

describe('every weekday, every week, every N weeks', () => {
  it('"every weekday" is Monday to Friday: the weekend is skipped', () => {
    // 2026-10-09 is a Friday
    expect(
      days(series(weekly(['MO', 'TU', 'WE', 'TH', 'FR']), '2026-10-09', '2026-10-16')),
    ).toEqual(['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  });

  it('repeats on the weekday of the first date when none is given', () => {
    expect(days(series(weekly(), '2026-10-05', '2026-10-26'))).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
  });

  it('repeats on several days of the week, in the order of the week whatever the order given', () => {
    expect(days(series(weekly(['WE', 'MO']), '2026-10-05', '2026-10-14'))).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-12',
      '2026-10-14',
    ]);
  });

  it('"every 2 weeks on Monday and Wednesday, 10 times"', () => {
    expect(days(series(weekly(['MO', 'WE'], 2, 10), '2026-10-05', '2027-12-31'))).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-19',
      '2026-10-21',
      '2026-11-02',
      '2026-11-04',
      '2026-11-16',
      '2026-11-18',
      '2026-11-30',
      '2026-12-02',
    ]);
  });

  it('counts the weeks from the week of the first date, which starts on a Monday', () => {
    // The first date is a Wednesday: its week still holds a Monday, before it, which is not a date.
    expect(days(series(weekly(['MO', 'WE'], 2), '2026-10-07', '2026-11-05'))).toEqual([
      '2026-10-07',
      '2026-10-19',
      '2026-10-21',
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('puts a Sunday at the end of its week, not at the start of the next', () => {
    // Sunday 2026-10-11 is the last day of the week of Monday 2026-10-05.
    expect(days(series(weekly(['SU'], 2), '2026-10-11', '2026-11-30'))).toEqual([
      '2026-10-11',
      '2026-10-25',
      '2026-11-08',
      '2026-11-22',
    ]);
  });
});

describe('every month, every N months', () => {
  it('repeats on a date', () => {
    expect(days(series(monthly({ kind: 'day', day: 15 }), '2026-10-15', '2027-01-31'))).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ]);
  });

  it('repeats on the day of the first date when no day is given', () => {
    expect(days(series(monthly(), '2026-01-15', '2026-04-30'))).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('repeats every N months', () => {
    expect(days(series(monthly({ kind: 'day', day: 15 }, 2), '2026-01-15', '2026-09-30'))).toEqual([
      '2026-01-15',
      '2026-03-15',
      '2026-05-15',
      '2026-07-15',
      '2026-09-15',
    ]);
  });

  it('puts the 29th, 30th and 31st on the last day of a month that is shorter, then goes back', () => {
    expect(days(series(monthly(), '2026-01-31', '2026-05-31'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    // 2028 is a leap year
    expect(days(series(monthly(), '2027-12-31', '2028-03-31'))).toEqual([
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('repeats on the last day of the month, whatever its length', () => {
    expect(days(series(monthly({ kind: 'lastDay' }), '2026-01-31', '2026-05-31'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    // starting on another day of the month: the first date is the last day of that month
    expect(days(series(monthly({ kind: 'lastDay' }), '2026-02-10', '2026-04-30'))).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('repeats on the Nth weekday: the 2nd Tuesday', () => {
    expect(
      days(series(monthly({ kind: 'nth', nth: 2, weekday: 'TU' }), '2026-10-13', '2027-01-31')),
    ).toEqual(['2026-10-13', '2026-11-10', '2026-12-08', '2027-01-12']);
  });

  it('repeats on the last weekday: the last Friday, in months of four and of five', () => {
    expect(
      days(series(monthly({ kind: 'nth', nth: -1, weekday: 'FR' }), '2026-10-30', '2027-01-31')),
    ).toEqual(['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29']);
  });

  it('the 1st and the 4th always exist, the 5th is "last"', () => {
    // February 2026 starts on a Sunday and has exactly 4 of each weekday
    expect(
      days(series(monthly({ kind: 'nth', nth: 4, weekday: 'SA' }), '2026-01-24', '2026-03-31')),
    ).toEqual(['2026-01-24', '2026-02-28', '2026-03-28']);
    expect(
      days(series(monthly({ kind: 'nth', nth: 1, weekday: 'MO' }), '2026-02-02', '2026-04-30')),
    ).toEqual(['2026-02-02', '2026-03-02', '2026-04-06']);
  });

  it('starts on the first matching day when the first date is before it in its month', () => {
    // asked for the 15th, starting on the 3rd: the first date is the 15th
    expect(days(series(monthly({ kind: 'day', day: 15 }), '2026-10-03', '2026-11-30'))).toEqual([
      '2026-10-15',
      '2026-11-15',
    ]);
    // asked for the 2nd Tuesday, starting after it in the month: the first date is next month's
    expect(
      days(series(monthly({ kind: 'nth', nth: 2, weekday: 'TU' }), '2026-10-20', '2026-12-31')),
    ).toEqual(['2026-11-10', '2026-12-08']);
  });
});

describe('every year, every N years', () => {
  it('repeats on the date of the first date', () => {
    expect(days(series(yearly(), '2026-03-15', '2029-12-31'))).toEqual([
      '2026-03-15',
      '2027-03-15',
      '2028-03-15',
      '2029-03-15',
    ]);
  });

  it('repeats every N years', () => {
    expect(days(series(yearly(undefined, 2), '2026-03-15', '2032-12-31'))).toEqual([
      '2026-03-15',
      '2028-03-15',
      '2030-03-15',
      '2032-03-15',
    ]);
  });

  it('puts the 29th of February on the 28th in the years that are not leap years', () => {
    expect(days(series(yearly(), '2028-02-29', '2032-12-31'))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('repeats on the Nth weekday of the month of the first date', () => {
    expect(
      days(series(yearly({ kind: 'nth', nth: 2, weekday: 'TU' }), '2026-03-10', '2028-12-31')),
    ).toEqual(['2026-03-10', '2027-03-09', '2028-03-14']);
  });

  it('repeats on the last weekday of the month of the first date', () => {
    expect(
      days(series(yearly({ kind: 'nth', nth: -1, weekday: 'FR' }), '2026-03-27', '2028-12-31')),
    ).toEqual(['2026-03-27', '2027-03-26', '2028-03-31']);
  });

  it('repeats on the last day of the month of the first date', () => {
    expect(days(series(yearly({ kind: 'lastDay' }), '2027-02-28', '2029-12-31'))).toEqual([
      '2027-02-28',
      '2028-02-29',
      '2029-02-28',
    ]);
  });
});

describe('how a series ends', () => {
  it('after N dates, whatever the end date is', () => {
    expect(days(series(weekly(undefined, 1, 3), '2026-10-05', '2030-01-01'))).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('at the end date when it comes before the Nth date', () => {
    expect(days(series(weekly(undefined, 1, 10), '2026-10-05', '2026-10-13'))).toEqual([
      '2026-10-05',
      '2026-10-12',
    ]);
  });

  it('one date is not a series', () => {
    expect(days(series(weekly(undefined, 1, 1), '2026-10-05', '2030-01-01'))).toEqual([
      '2026-10-05',
    ]);
  });

  it('the last date of a counted series is where the database is told it ends', () => {
    const source = series(weekly(['MO', 'WE'], 2, 10), '2026-10-05', '2030-01-01');
    const end = endOfCountedRule(source.repeat!, source.startsAt, source.endsAt, PARIS);
    expect(end && formatLocalInput(end, PARIS)).toBe('2026-12-02T18:00');
    expect(endOfCountedRule(weekly(), source.startsAt, source.endsAt, PARIS)).toBeNull();
  });

  it('never goes over what an event holds, and says it did', () => {
    const endless = series({ freq: 'DAILY', interval: 1 }, '2026-01-01', '2100-01-01');
    const result = expandRepeat(endless, PARIS);
    expect(result.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(result.truncated).toBe(true);
  });

  it('does not say it cut a series that has exactly as many dates as an event holds', () => {
    const exact = series(
      { freq: 'DAILY', interval: 1, count: MAX_OCCURRENCES },
      '2026-01-01',
      '2100-01-01',
    );
    const result = expandRepeat(exact, PARIS);
    expect(result.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(result.truncated).toBe(false);
  });

  it('an event without a rule, or without an end, is one date', () => {
    expect(days(series(null, '2026-10-05', '2026-12-31'))).toEqual(['2026-10-05']);
    expect(days(series(weekly(), '2026-10-05', null))).toEqual(['2026-10-05']);
  });
});

describe('changes of hour, in every zone', () => {
  const clock = (source: ReturnType<typeof series>) =>
    expandRepeat(source, source.zone).occurrences.map((o) =>
      formatLocalInput(o.start, source.zone).slice(11),
    );

  it.each([
    ['Europe/Paris', '2026-10-19', '2026-11-02'], // summer time ends on 25 October
    ['Europe/Paris', '2027-03-22', '2027-04-05'], // summer time starts on 28 March
    ['America/New_York', '2026-10-26', '2026-11-09'], // ends on 1 November
    ['America/New_York', '2027-03-08', '2027-03-22'], // starts on 14 March
    ['Pacific/Auckland', '2026-03-30', '2026-04-13'], // ends on 5 April
    ['Pacific/Auckland', '2026-09-21', '2026-10-05'], // starts on 27 September
  ])('keeps 18:00 on the wall clock in %s from %s to %s', (zone, from, until) => {
    const source = series({ freq: 'DAILY', interval: 1 }, `${from}T18:00`, until, { zone });
    expect(new Set(clock(source))).toEqual(new Set(['18:00']));
  });

  it('keeps the duration of every date, changes of hour included', () => {
    const source = series(weekly(), '2026-10-19T18:00', '2026-11-09', { hours: 3 });
    for (const o of expandRepeat(source, PARIS).occurrences) {
      expect(o.end.getTime() - o.start.getTime()).toBe(3 * 3_600_000);
    }
  });

  it('puts a time that does not exist (the hour that was skipped) one hour later, and only that day', () => {
    // 2026-03-29, 02:30 does not exist in Paris
    const source = series({ freq: 'DAILY', interval: 1 }, '2026-03-28T02:30', '2026-03-30');
    expect(
      expandRepeat(source, PARIS).occurrences.map((o) => formatLocalInput(o.start, PARIS)),
    ).toEqual(['2026-03-28T02:30', '2026-03-29T03:30', '2026-03-30T02:30']);
  });

  it('keeps one date for a time that happens twice (the hour that was repeated)', () => {
    // 2026-10-25, 02:30 happens twice in Paris
    const source = series({ freq: 'DAILY', interval: 1 }, '2026-10-24T02:30', '2026-10-26');
    expect(days(source)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });
});

describe('the rule without what is "like the first date"', () => {
  it('is filled in from the first date', () => {
    const first = { year: 2026, month: 10, day: 7 }; // a Wednesday
    expect(weekdayOf(first)).toBe('WE');
    expect(resolveRule({ freq: 'WEEKLY', interval: 1 }, first)).toMatchObject({ weekdays: ['WE'] });
    expect(resolveRule({ freq: 'MONTHLY', interval: 1 }, first)).toMatchObject({
      monthly: { kind: 'day', day: 7 },
    });
    expect(
      resolveRule({ freq: 'MONTHLY', interval: 1, monthly: { kind: 'lastDay' } }, first).monthly,
    ).toEqual({ kind: 'lastDay' });
  });

  it('follows the first date when it moves: a weekly series on a Monday moved to a Tuesday', () => {
    const moved = series(weekly(), '2026-10-06', '2026-10-27');
    expect(days(moved)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });
});

describe('alignStart', () => {
  const at = (start: string) => {
    const source = series(null, start, null);
    return { startsAt: source.startsAt, endsAt: source.endsAt };
  };
  const local = (date: Date) => formatLocalInput(date, PARIS);

  it('leaves a first date that fits the rule where it is', () => {
    const { startsAt, endsAt } = at('2026-10-05T18:00');
    expect(alignStart(weekly(['MO', 'WE']), startsAt, endsAt, PARIS)).toEqual({ startsAt, endsAt });
  });

  it('moves it to the first day that fits, at the same hour, with the same duration', () => {
    // a Tuesday, with "Monday and Wednesday"
    const { startsAt, endsAt } = at('2026-10-06T18:00');
    const aligned = alignStart(weekly(['MO', 'WE']), startsAt, endsAt, PARIS);
    expect(local(aligned.startsAt)).toBe('2026-10-07T18:00');
    expect(aligned.endsAt.getTime() - aligned.startsAt.getTime()).toBe(2 * 3_600_000);
  });

  it('moves it to the 15th, or to the second Tuesday of the month', () => {
    const { startsAt, endsAt } = at('2026-10-03T18:00');
    expect(
      local(alignStart(monthly({ kind: 'day', day: 15 }), startsAt, endsAt, PARIS).startsAt),
    ).toBe('2026-10-15T18:00');
    expect(
      local(
        alignStart(monthly({ kind: 'nth', nth: 2, weekday: 'TU' }), startsAt, endsAt, PARIS)
          .startsAt,
      ),
    ).toBe('2026-10-06T18:00'.replace('06', '13'));
  });
});

describe('readRepeatRule', () => {
  it('reads what the migration wrote, and what the form writes', () => {
    expect(readRepeatRule({ freq: 'WEEKLY', interval: 2 })).toEqual({
      freq: 'WEEKLY',
      interval: 2,
    });
    expect(
      readRepeatRule({ freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 31 } }),
    ).toEqual({ freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 31 } });
  });

  it('writes the weekdays in the order of the week, each once', () => {
    expect(readRepeatRule({ freq: 'WEEKLY', interval: 1, weekdays: ['FR', 'MO', 'FR'] })).toEqual({
      freq: 'WEEKLY',
      interval: 1,
      weekdays: ['MO', 'FR'],
    });
    expect(
      normalizeRule({ freq: 'WEEKLY', interval: 1, weekdays: [...WEEKDAYS].reverse() }).weekdays,
    ).toEqual([...WEEKDAYS]);
  });

  it.each([
    ['nothing', null],
    ['a string', 'WEEKLY'],
    ['a number', 3],
    ['an array', []],
    ['no frequency', { interval: 1 }],
    ['a frequency that does not exist', { freq: 'HOURLY', interval: 1 }],
    ['an interval of 0', { freq: 'DAILY', interval: 0 }],
    ['an interval of 100', { freq: 'DAILY', interval: 100 }],
    ['a fraction as interval', { freq: 'DAILY', interval: 1.5 }],
    ['weekdays on a monthly rule', { freq: 'MONTHLY', interval: 1, weekdays: ['MO'] }],
    [
      'a day of the month on a weekly rule',
      { freq: 'WEEKLY', interval: 1, monthly: { kind: 'lastDay' } },
    ],
    ['no weekday at all', { freq: 'WEEKLY', interval: 1, weekdays: [] }],
    ['a weekday that does not exist', { freq: 'WEEKLY', interval: 1, weekdays: ['XX'] }],
    ['the 32nd', { freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 32 } }],
    [
      'the 5th weekday',
      { freq: 'MONTHLY', interval: 1, monthly: { kind: 'nth', nth: 5, weekday: 'MO' } },
    ],
    ['a count of 0', { freq: 'DAILY', interval: 1, count: 0 }],
    ['a count over the limit', { freq: 'DAILY', interval: 1, count: MAX_OCCURRENCES + 1 }],
    ['a key it does not know', { freq: 'DAILY', interval: 1, until: '2026-01-01' }],
  ])('is not a rule: %s', (_label, value) => {
    expect(readRepeatRule(value)).toBeNull();
  });
});

// ---- the engine against a second, differently written, way of finding the dates ----------------------------------------

/** Mulberry32: a small seeded generator, so a failure can be played again. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dim = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Looks at every day, one after the other, and asks the calendar (`getUTCDay`, never the rule's arithmetic). */
function byScanning(rule: RepeatRule, first: Date, last: Date): string[] {
  const weekdays = rule.weekdays ?? [WEEKDAYS[(first.getUTCDay() + 6) % 7]!];
  const pattern: MonthlyPattern = rule.monthly ?? { kind: 'day', day: first.getUTCDate() };
  const weekOf = (d: Date) =>
    Math.floor((d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000) / (7 * 86_400_000));
  const fits = (d: Date): boolean => {
    const date = d.getUTCDate();
    const onPattern =
      pattern.kind === 'day'
        ? date === Math.min(pattern.day, dim(d))
        : pattern.kind === 'lastDay'
          ? date === dim(d)
          : WEEKDAYS[(d.getUTCDay() + 6) % 7] === pattern.weekday &&
            (pattern.nth === -1 ? date + 7 > dim(d) : Math.ceil(date / 7) === pattern.nth);
    const months =
      (d.getUTCFullYear() - first.getUTCFullYear()) * 12 + d.getUTCMonth() - first.getUTCMonth();
    switch (rule.freq) {
      case 'DAILY':
        return Math.round((d.getTime() - first.getTime()) / 86_400_000) % rule.interval === 0;
      case 'WEEKLY':
        return (
          weekdays.includes(WEEKDAYS[(d.getUTCDay() + 6) % 7]!) &&
          (weekOf(d) - weekOf(first)) % rule.interval === 0
        );
      case 'MONTHLY':
        return months % rule.interval === 0 && onPattern;
      case 'YEARLY':
        return (
          months % (12 * rule.interval) === 0 &&
          d.getUTCMonth() === first.getUTCMonth() &&
          onPattern
        );
    }
  };
  const found: string[] = [];
  for (
    let d = new Date(first);
    d.getTime() <= last.getTime();
    d = new Date(d.getTime() + 86_400_000)
  ) {
    if (fits(d)) found.push(ymd(d));
  }
  return found;
}

describe('the engine, against a way of finding the dates that looks at every day', () => {
  const zones = ['Europe/Paris', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC'];

  it('finds the same dates for a thousand rules chosen at random', () => {
    const next = random(20261016);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!;

    for (let round = 0; round < 1000; round += 1) {
      const freq = pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const);
      const interval = pick([1, 1, 1, 2, 3, 5]);
      const weekdays = [...WEEKDAYS].filter(() => next() < 0.35);
      const nth = pick([1, 2, 3, 4, -1] as const);
      const rule: RepeatRule = {
        freq,
        interval,
        ...(freq === 'WEEKLY' && weekdays.length > 0 ? { weekdays } : {}),
        ...((freq === 'MONTHLY' || freq === 'YEARLY') && next() < 0.8
          ? {
              monthly: pick<MonthlyPattern>([
                { kind: 'day', day: 1 + Math.floor(next() * 31) },
                { kind: 'lastDay' },
                { kind: 'nth', nth, weekday: pick(WEEKDAYS) },
              ]),
            }
          : {}),
      };
      const year = 2024 + Math.floor(next() * 6);
      const first = new Date(Date.UTC(year, Math.floor(next() * 12), 1 + Math.floor(next() * 28)));
      const span = freq === 'DAILY' ? 300 : freq === 'YEARLY' ? 365 * 25 : 365 * 5;
      const last = new Date(first.getTime() + span * 86_400_000);
      const zone = pick(zones);

      const source = {
        startsAt: fromLocalDateTime(
          {
            year: first.getUTCFullYear(),
            month: first.getUTCMonth() + 1,
            day: first.getUTCDate(),
            hour: 18,
            minute: 0,
          },
          zone,
        ),
        endsAt: fromLocalDateTime(
          {
            year: first.getUTCFullYear(),
            month: first.getUTCMonth() + 1,
            day: first.getUTCDate(),
            hour: 20,
            minute: 0,
          },
          zone,
        ),
        repeat: rule,
        recurrenceUntil: fromLocalDateTime(
          {
            year: last.getUTCFullYear(),
            month: last.getUTCMonth() + 1,
            day: last.getUTCDate(),
            hour: 23,
            minute: 59,
          },
          zone,
        ),
      };
      const got = expandRepeat(source, zone).occurrences.map((o) =>
        formatLocalInput(o.start, zone).slice(0, 10),
      );
      const wanted = byScanning(rule, first, last).slice(0, MAX_OCCURRENCES);
      expect(got, `${zone} ${ymd(first)} ${JSON.stringify(rule)}`).toEqual(wanted);
    }
  });

  it('gives dates in strictly increasing order, each at the hour of the first date', () => {
    const next = random(7);
    for (let round = 0; round < 100; round += 1) {
      const rule: RepeatRule = {
        freq: 'WEEKLY',
        interval: 1 + Math.floor(next() * 3),
        weekdays: [...WEEKDAYS].filter(() => next() < 0.5).concat('MO'),
      };
      const source = series(rule, '2026-10-05T19:30', '2027-12-31');
      const starts = expandRepeat(source, PARIS).occurrences.map((o) => o.start.getTime());
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(new Set(starts).size).toBe(starts.length);
      for (const start of starts) {
        const local = toLocalDateTime(new Date(start), PARIS);
        expect([local.hour, local.minute]).toEqual([19, 30]);
      }
    }
  });
});

// ---- the series that existed before the rules -------------------------------------------------------------------------

/** The dates of a series as the first versions worked them out, kept here as the proof that the migration moves none. */
function legacyOccurrences(
  source: {
    startsAt: Date;
    endsAt: Date;
    kind: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
    until: Date;
    monthlyDay: number | null;
  },
  timeZone: string,
) {
  const cap = 200;
  const base = toLocalDateTime(source.startsAt, timeZone);
  const out: Date[] = [];
  for (let index = 0; index < cap; index += 1) {
    let date: { year: number; month: number; day: number };
    if (source.kind === 'MONTHLY') {
      const monthIndex = base.month - 1 + index;
      const year = base.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      date = {
        year,
        month,
        day: Math.min(
          source.monthlyDay ?? base.day,
          new Date(Date.UTC(year, month, 0)).getUTCDate(),
        ),
      };
    } else {
      date = addDays(base, index * (source.kind === 'WEEKLY' ? 7 : 14));
    }
    const start = fromLocalDateTime({ ...date, hour: base.hour, minute: base.minute }, timeZone);
    if (start.getTime() > source.until.getTime()) break;
    out.push(start);
  }
  return out;
}

/** What the migration writes for a series of the first versions (prisma/migrations/…_event_repeat_rules). */
function migrated(kind: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY', monthlyDay: number | null): RepeatRule {
  if (kind === 'WEEKLY') return { freq: 'WEEKLY', interval: 1 };
  if (kind === 'BIWEEKLY') return { freq: 'WEEKLY', interval: 2 };
  return {
    freq: 'MONTHLY',
    interval: 1,
    ...(monthlyDay === null ? {} : { monthly: { kind: 'day', day: monthlyDay } }),
  };
}

describe('the series that existed before the rules', () => {
  it('keep every date to the millisecond, hence every identifier in the calendar files', () => {
    const next = random(42);
    const zones = ['Europe/Paris', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC'];
    for (let round = 0; round < 1500; round += 1) {
      const kind = (['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const)[Math.floor(next() * 3)]!;
      const zone = zones[Math.floor(next() * zones.length)]!;
      const monthlyDay = kind === 'MONTHLY' && next() < 0.5 ? 28 + Math.floor(next() * 4) : null;
      // a series is anchored on a day it falls on: with a `monthlyDay`, the day of the month it gives (or the last)
      const year = 2024 + Math.floor(next() * 6);
      const month = 1 + Math.floor(next() * 12);
      const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const day = monthlyDay === null ? 1 + Math.floor(next() * 28) : Math.min(monthlyDay, length);
      const hour = Math.floor(next() * 24);
      const startsAt = fromLocalDateTime(
        { year, month, day, hour, minute: 15 * Math.floor(next() * 4) },
        zone,
      );
      const endsAt = new Date(startsAt.getTime() + (1 + Math.floor(next() * 5)) * 3_600_000);
      const until = new Date(startsAt.getTime() + Math.floor(next() * 900) * 86_400_000);

      const before = legacyOccurrences({ startsAt, endsAt, kind, until, monthlyDay }, zone);
      const after = expandRepeat(
        { startsAt, endsAt, repeat: migrated(kind, monthlyDay), recurrenceUntil: until },
        zone,
      ).occurrences.map((o) => o.start);
      const label = `${kind} ${zone} ${startsAt.toISOString()} until ${until.toISOString()} day ${monthlyDay}`;
      expect(
        after.map((d) => d.getTime()),
        label,
      ).toEqual(before.slice(0, MAX_OCCURRENCES).map((d) => d.getTime()));
    }
  });
});

describe('sameRepeat', () => {
  const first = { year: 2026, month: 10, day: 10 }; // a Saturday, the 10th

  it('is true for rules that give the same dates, whatever they leave out', () => {
    expect(sameRepeat(null, null, first)).toBe(true);
    expect(
      sameRepeat(
        { freq: 'WEEKLY', interval: 1 },
        { freq: 'WEEKLY', interval: 1, weekdays: ['SA'] },
        first,
      ),
    ).toBe(true);
    expect(
      sameRepeat(
        { freq: 'MONTHLY', interval: 1 },
        { freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 10 } },
        first,
      ),
    ).toBe(true);
  });

  it('is false as soon as one date would differ', () => {
    const base: RepeatRule = { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 };
    expect(sameRepeat(base, { ...base }, first)).toBe(true);
    expect(sameRepeat(base, { ...base, count: 8 }, first)).toBe(false);
    expect(sameRepeat(base, { ...base, count: undefined }, first)).toBe(false);
    expect(sameRepeat(base, { ...base, interval: 1 }, first)).toBe(false);
    expect(sameRepeat(base, { ...base, weekdays: ['MO'] }, first)).toBe(false);
    expect(sameRepeat(base, { ...base, freq: 'DAILY' }, first)).toBe(false);
    expect(sameRepeat(base, null, first)).toBe(false);
    expect(sameRepeat(null, base, first)).toBe(false);
    expect(
      sameRepeat(
        { freq: 'MONTHLY', interval: 1 },
        { freq: 'MONTHLY', interval: 1, monthly: { kind: 'lastDay' } },
        first,
      ),
    ).toBe(false);
  });

  it('does not depend on the order in which the days are written', () => {
    expect(
      sameRepeat(
        { freq: 'WEEKLY', interval: 1, weekdays: ['WE', 'MO'] },
        { freq: 'WEEKLY', interval: 1, weekdays: ['MO', 'WE'] },
        first,
      ),
    ).toBe(true);
  });
});

describe('isRepeating', () => {
  const rule = { freq: 'WEEKLY', interval: 1 };
  const until = new Date('2026-12-01T00:00:00Z');

  it('needs a rule it can read and an end: a series has both', () => {
    expect(isRepeating({ repeat: rule, recurrenceUntil: until })).toBe(true);
    expect(isRepeating({ repeat: rule, recurrenceUntil: null })).toBe(false);
    expect(isRepeating({ repeat: null, recurrenceUntil: until })).toBe(false);
    expect(isRepeating({ recurrenceUntil: until })).toBe(false);
    expect(isRepeating({ repeat: { freq: 'HOURLY' }, recurrenceUntil: until })).toBe(false);
  });
});
