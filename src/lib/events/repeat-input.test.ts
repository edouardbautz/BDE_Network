import { describe, expect, it } from 'vitest';
import { MAX_OCCURRENCES, sameRepeat, type RepeatRule } from './repeat';
import {
  NO_REPEAT,
  REPEAT_PRESETS,
  isLastDayOfMonth,
  isLastWeekdayOfMonth,
  monthlyPatternOf,
  ordinalOfWeekday,
  parseRepeatInput,
  planRepeat,
  presetOf,
  presetRule,
  rawRepeatOf,
} from './repeat-input';
import { fromLocalDateTime, toLocalDateTime } from './time';

const PARIS = 'Europe/Paris';
// Saturday 10 October 2026: the 2nd Saturday of its month
const SAT_10 = { year: 2026, month: 10, day: 10 };
// Saturday 31 October 2026: the 5th Saturday, and the last day of its month
const SAT_31 = { year: 2026, month: 10, day: 31 };

describe('what a date is in its month', () => {
  it('counts the weekday of the month, and knows the last ones', () => {
    expect(ordinalOfWeekday(SAT_10)).toBe(2);
    expect(ordinalOfWeekday(SAT_31)).toBe(5);
    expect(isLastWeekdayOfMonth(SAT_31)).toBe(true);
    expect(isLastWeekdayOfMonth({ year: 2026, month: 10, day: 24 })).toBe(false);
    // 24 + 7 = 31: the 24th of a 31-day month is not the last, the 25th is
    expect(isLastWeekdayOfMonth({ year: 2026, month: 10, day: 25 })).toBe(true);
    expect(isLastDayOfMonth(SAT_31)).toBe(true);
    expect(isLastDayOfMonth({ year: 2028, month: 2, day: 28 })).toBe(false);
    expect(isLastDayOfMonth({ year: 2028, month: 2, day: 29 })).toBe(true);
  });

  it('offers "the 2nd Saturday" only when the date is not a 5th one', () => {
    expect(monthlyPatternOf('nth', SAT_10)).toEqual({ kind: 'nth', nth: 2, weekday: 'SA' });
    expect(monthlyPatternOf('nth', SAT_31)).toBeNull();
    expect(monthlyPatternOf('last', SAT_31)).toEqual({ kind: 'nth', nth: -1, weekday: 'SA' });
    expect(monthlyPatternOf('day', SAT_10)).toEqual({ kind: 'day', day: 10 });
    expect(monthlyPatternOf('day', SAT_10, 31)).toEqual({ kind: 'day', day: 31 });
    expect(monthlyPatternOf('lastDay', SAT_10)).toEqual({ kind: 'lastDay' });
  });
});

describe('the choices of the list', () => {
  it('has a rule for each, except "does not repeat" and "custom"', () => {
    expect(presetRule('NONE', SAT_10)).toBeNull();
    expect(presetRule('CUSTOM', SAT_10)).toBeNull();
    for (const preset of REPEAT_PRESETS.filter((p) => p !== 'NONE' && p !== 'CUSTOM')) {
      expect(presetRule(preset, SAT_10), preset).not.toBeNull();
    }
  });

  it('says "the last" for a first date that is a 5th weekday', () => {
    expect(presetRule('MONTHLY_NTH', SAT_31)).toEqual({
      freq: 'MONTHLY',
      interval: 1,
      monthly: { kind: 'nth', nth: -1, weekday: 'SA' },
    });
  });

  it('recognises a stored rule as the choice it is, and as custom when it is none', () => {
    for (const preset of REPEAT_PRESETS.filter((p) => p !== 'NONE' && p !== 'CUSTOM')) {
      expect(presetOf(presetRule(preset, SAT_10), SAT_10), preset).toBe(preset);
    }
    expect(presetOf(null, SAT_10)).toBe('NONE');
    expect(presetOf({ freq: 'WEEKLY', interval: 2 }, SAT_10)).toBe('CUSTOM');
    expect(presetOf({ freq: 'WEEKLY', interval: 1, weekdays: ['MO', 'WE'] }, SAT_10)).toBe(
      'CUSTOM',
    );
    // a rule that spells out what the choice leaves out is still that choice
    expect(presetOf({ freq: 'WEEKLY', interval: 1, weekdays: ['SA'] }, SAT_10)).toBe('WEEKLY');
    expect(
      presetOf({ freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 10 } }, SAT_10),
    ).toBe('MONTHLY');
    // ...but not when it is another day than the first date's
    expect(
      presetOf({ freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 31 } }, SAT_10),
    ).toBe('CUSTOM');
  });

  it('a series that ends after some dates is still the choice it repeats', () => {
    expect(presetOf({ freq: 'WEEKLY', interval: 1, count: 8 }, SAT_10)).toBe('WEEKLY');
  });
});

describe('the form of a stored rule, and back', () => {
  const rules: RepeatRule[] = [
    { freq: 'DAILY', interval: 1 },
    { freq: 'DAILY', interval: 4, count: 12 },
    { freq: 'WEEKLY', interval: 1 },
    { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 },
    { freq: 'WEEKLY', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] },
    { freq: 'MONTHLY', interval: 1 },
    { freq: 'MONTHLY', interval: 3, monthly: { kind: 'day', day: 31 } },
    { freq: 'MONTHLY', interval: 1, monthly: { kind: 'nth', nth: 2, weekday: 'SA' } },
    { freq: 'MONTHLY', interval: 2, monthly: { kind: 'nth', nth: -1, weekday: 'SA' }, count: 5 },
    { freq: 'MONTHLY', interval: 1, monthly: { kind: 'lastDay' } },
    { freq: 'YEARLY', interval: 1 },
    { freq: 'YEARLY', interval: 2, monthly: { kind: 'lastDay' } },
  ];

  it.each(rules.map((rule) => [JSON.stringify(rule), rule] as const))(
    'gives back the same dates: %s',
    (_label, rule) => {
      const raw = rawRepeatOf(rule, SAT_10, '2030-12-31');
      const parsed = parseRepeatInput(raw, SAT_10);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(sameRepeat(parsed.rule, rule, SAT_10)).toBe(true);
    },
  );

  it('keeps the end the way the rule has it: a count in the number, a date in the date', () => {
    expect(
      rawRepeatOf({ freq: 'DAILY', interval: 1, count: 12 }, SAT_10, '2030-12-31'),
    ).toMatchObject({ repeatEnd: 'count', repeatCount: '12', recurrenceUntil: '' });
    expect(rawRepeatOf({ freq: 'DAILY', interval: 1 }, SAT_10, '2030-12-31')).toMatchObject({
      repeatEnd: 'until',
      recurrenceUntil: '2030-12-31',
    });
  });

  it('fills the custom panel from the rule, so choosing "custom" starts from what it was', () => {
    expect(rawRepeatOf({ freq: 'WEEKLY', interval: 1 }, SAT_10, '2030-12-31')).toMatchObject({
      repeat: 'WEEKLY',
      repeatFreq: 'WEEKLY',
      repeatInterval: '1',
      repeatWeekdays: ['SA'],
    });
  });

  it('is the default form when there is no rule', () => {
    expect(rawRepeatOf(null, SAT_10, '2030-12-31')).toEqual(NO_REPEAT);
  });
});

describe('planRepeat', () => {
  const at = (day: number, hour = 20) => {
    const startsAt = fromLocalDateTime({ year: 2026, month: 10, day, hour, minute: 0 }, PARIS);
    return {
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      startLocal: toLocalDateTime(startsAt, PARIS),
    };
  };
  const plan = (raw: Partial<typeof NO_REPEAT>, first = at(10)) =>
    planRepeat({ ...NO_REPEAT, ...raw }, first, PARIS);

  it('has no end and no rule for an event that does not repeat, and the dates as typed', () => {
    const first = at(10);
    expect(plan({})).toEqual({
      ok: true,
      rule: null,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      startLocal: first.startLocal,
      recurrenceUntil: null,
    });
  });

  it('ends a series at the end of the last day, local time', () => {
    const result = plan({ repeat: 'WEEKLY', recurrenceUntil: '2026-10-31' });
    expect(result.ok && result.recurrenceUntil).toEqual(
      fromLocalDateTime({ year: 2026, month: 10, day: 31, hour: 23, minute: 59 }, PARIS),
    );
  });

  it('ends a counted series where its last date starts', () => {
    const result = plan({ repeat: 'DAILY', repeatEnd: 'count', repeatCount: '3' });
    expect(result.ok && result.recurrenceUntil).toEqual(at(12).startsAt);
  });

  it('moves the first date to the first that fits, keeping hour and duration', () => {
    // Saturday with "Monday and Wednesday"
    const result = plan({
      repeat: 'CUSTOM',
      repeatFreq: 'WEEKLY',
      repeatInterval: '1',
      repeatWeekdays: ['MO', 'WE'],
      recurrenceUntil: '2026-11-30',
    });
    expect(result.ok && result.startsAt).toEqual(at(12).startsAt);
    expect(result.ok && result.endsAt).toEqual(at(12).endsAt);
  });

  it('refuses an end before the first date that fits', () => {
    // the first date that fits is Monday 12; the end is Sunday 11
    expect(
      plan({
        repeat: 'CUSTOM',
        repeatFreq: 'WEEKLY',
        repeatInterval: '1',
        repeatWeekdays: ['MO'],
        recurrenceUntil: '2026-10-11',
      }),
    ).toEqual({ ok: false, errors: { recurrenceUntil: 'untilBeforeStart' } });
  });

  it('refuses a series longer than an event holds, but not one of exactly that length', () => {
    expect(plan({ repeat: 'DAILY', recurrenceUntil: '2028-01-01' })).toEqual({
      ok: false,
      errors: { recurrenceUntil: 'tooManyOccurrences' },
    });
    const exact = plan({
      repeat: 'DAILY',
      repeatEnd: 'count',
      repeatCount: String(MAX_OCCURRENCES),
    });
    expect(exact.ok).toBe(true);
  });

  it('keeps the hour on the days the clocks change', () => {
    // every day at 20:00 from 24 October 2026 through 2 November: Paris goes back to winter time on the 25th
    const result = plan({ repeat: 'DAILY', recurrenceUntil: '2026-11-02' }, at(24));
    expect(result.ok).toBe(true);
    if (result.ok) expect(toLocalDateTime(result.startsAt, PARIS).hour).toBe(20);
  });
});

describe('parseRepeatInput on a first date that is not known', () => {
  it('does not repeat, and says nothing about the rest, when "does not repeat"', () => {
    expect(parseRepeatInput({ ...NO_REPEAT, repeatCount: 'abc' }, null)).toEqual({
      ok: true,
      rule: null,
      untilDay: null,
    });
  });
});
