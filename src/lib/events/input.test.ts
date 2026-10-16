import { describe, expect, it } from 'vitest';
import { parseEventInput, type RawEventInput } from './input';
import { MAX_OCCURRENCES } from './repeat';
import { NO_REPEAT } from './repeat-input';

const options = { timeZone: 'Europe/Paris', categoryKeys: ['soiree', 'sport'] };

function raw(overrides: Partial<RawEventInput> = {}): RawEventInput {
  return {
    title: 'Soirée de rentrée',
    description: 'Venez nombreux',
    location: 'Salle B',
    categoryKey: 'soiree',
    startsAt: '2026-10-10T20:00',
    endsAt: '2026-10-11T02:00',
    ...NO_REPEAT,
    status: 'DRAFT',
    assigneeLogins: [],
    ...overrides,
  };
}

describe('parseEventInput', () => {
  it('converts wall-clock inputs in the BDE zone to UTC and derives the school year', () => {
    const result = parseEventInput(raw(), options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.startsAt).toEqual(new Date('2026-10-10T18:00:00Z'));
      expect(result.data.endsAt).toEqual(new Date('2026-10-11T00:00:00Z'));
      expect(result.data.schoolYear).toBe('2026-2027');
      expect(result.data.recurrenceUntil).toBeNull();
      expect(result.data.description).toBe('Venez nombreux');
      expect(result.data.location).toBe('Salle B');
    }
  });

  it('uses winter time (UTC+1) for dates outside summer time', () => {
    const result = parseEventInput(
      raw({ startsAt: '2026-12-10T20:00', endsAt: '2026-12-10T22:00' }),
      options,
    );
    expect(result.ok && result.data.startsAt).toEqual(new Date('2026-12-10T19:00:00Z'));
  });

  it('trims text and deduplicates assignees', () => {
    const result = parseEventInput(
      raw({ title: '  Tournoi  ', assigneeLogins: ['alice', ' alice ', 'bob', ''] }),
      options,
    );
    expect(result.ok && result.data.title).toBe('Tournoi');
    expect(result.ok && result.data.assigneeLogins).toEqual(['alice', 'bob']);
  });

  it('requires a title and a known category', () => {
    const result = parseEventInput(raw({ title: '   ', categoryKey: 'unknown' }), options);
    expect(result).toEqual({
      ok: false,
      errors: { title: 'required', categoryKey: 'invalid' },
    });
  });

  describe('required fields', () => {
    it.each([
      ['title', 'required'],
      ['description', 'required'],
      ['location', 'required'],
      ['categoryKey', 'required'],
      ['startsAt', 'required'],
      ['endsAt', 'required'],
    ] as const)('rejects an empty %s', (field, code) => {
      expect(parseEventInput(raw({ [field]: '' }), options)).toEqual({
        ok: false,
        errors: { [field]: code },
      });
    });

    it.each(['title', 'description', 'location'] as const)(
      'treats a whitespace-only %s as empty',
      (field) => {
        expect(parseEventInput(raw({ [field]: '   ' }), options)).toEqual({
          ok: false,
          errors: { [field]: 'required' },
        });
      },
    );

    it('reports every missing field at once, so the form can show them all', () => {
      const result = parseEventInput(
        raw({
          title: '',
          description: '',
          location: '',
          categoryKey: '',
          startsAt: '',
          endsAt: '',
        }),
        options,
      );
      expect(result).toEqual({
        ok: false,
        errors: {
          title: 'required',
          description: 'required',
          location: 'required',
          categoryKey: 'required',
          startsAt: 'required',
          endsAt: 'required',
        },
      });
    });

    it('keeps the members in charge optional', () => {
      const result = parseEventInput(raw({ assigneeLogins: [] }), options);
      expect(result.ok).toBe(true);
    });

    it('trims the required texts it keeps', () => {
      const result = parseEventInput(
        raw({ description: '  Venez  ', location: '  Salle B ' }),
        options,
      );
      expect(result.ok && [result.data.description, result.data.location]).toEqual([
        'Venez',
        'Salle B',
      ]);
    });
  });

  it('rejects an end that is not after the start', () => {
    const result = parseEventInput(raw({ endsAt: '2026-10-10T20:00' }), options);
    expect(result).toEqual({ ok: false, errors: { endsAt: 'endBeforeStart' } });
  });

  it('rejects missing or malformed dates', () => {
    expect(parseEventInput(raw({ startsAt: '' }), options)).toMatchObject({
      ok: false,
      errors: { startsAt: 'required' },
    });
    expect(parseEventInput(raw({ endsAt: '2026-02-30T10:00' }), options)).toMatchObject({
      ok: false,
      errors: { endsAt: 'invalid' },
    });
  });

  it('rejects over-long fields', () => {
    const result = parseEventInput(
      raw({ title: 'x'.repeat(121), location: 'y'.repeat(201), description: 'z'.repeat(5001) }),
      options,
    );
    expect(result).toEqual({
      ok: false,
      errors: { title: 'tooLong', location: 'tooLong', description: 'tooLong' },
    });
  });

  describe('repeat', () => {
    const parse = (overrides: Partial<RawEventInput>) => parseEventInput(raw(overrides), options);
    const weekly = (overrides: Partial<RawEventInput> = {}) =>
      parse({ repeat: 'WEEKLY', recurrenceUntil: '2026-10-31', ...overrides });
    const data = (overrides: Partial<RawEventInput>) => {
      const result = parse(overrides);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.data;
    };

    it('does not repeat by default: no rule, no end', () => {
      expect(data({})).toMatchObject({ repeat: null, recurrenceUntil: null });
    });

    it('requires an end for a series: a date, or a number of dates', () => {
      expect(parse({ repeat: 'WEEKLY' })).toEqual({
        ok: false,
        errors: { recurrenceUntil: 'untilRequired' },
      });
      expect(parse({ repeat: 'WEEKLY', repeatEnd: 'count', repeatCount: '' })).toEqual({
        ok: false,
        errors: { repeatCount: 'countInvalid' },
      });
    });

    it('rejects an end date before the first date', () => {
      expect(weekly({ recurrenceUntil: '2026-10-01' })).toEqual({
        ok: false,
        errors: { recurrenceUntil: 'untilBeforeStart' },
      });
    });

    it('treats the end date as inclusive (end of that local day)', () => {
      // 23:59 Paris on 24 Oct (UTC+2) = 21:59 UTC
      expect(data({ repeat: 'WEEKLY', recurrenceUntil: '2026-10-24' }).recurrenceUntil).toEqual(
        new Date('2026-10-24T21:59:00Z'),
      );
    });

    it('ignores everything about the repetition of an event that does not repeat', () => {
      expect(
        data({
          repeat: 'NONE',
          recurrenceUntil: '2030-01-01',
          repeatCount: 'abc',
          repeatFreq: 'HOURLY',
          repeatInterval: '0',
        }),
      ).toMatchObject({ repeat: null, recurrenceUntil: null });
    });

    it('rejects a choice that is not in the list', () => {
      expect(parse({ repeat: 'HOURLY' })).toMatchObject({
        ok: false,
        errors: { repeat: 'invalid' },
      });
      expect(parse({ repeat: '' })).toMatchObject({ ok: false, errors: { repeat: 'invalid' } });
    });

    it('rejects a series with more dates than an event holds, and names the end date', () => {
      expect(parse({ repeat: 'DAILY', recurrenceUntil: '2030-01-01' })).toEqual({
        ok: false,
        errors: { recurrenceUntil: 'tooManyOccurrences' },
      });
    });

    it('accepts a series that has exactly as many dates as an event holds', () => {
      expect(
        data({ repeat: 'DAILY', repeatEnd: 'count', repeatCount: String(MAX_OCCURRENCES) }).repeat,
      ).toEqual({ freq: 'DAILY', interval: 1, count: MAX_OCCURRENCES });
    });

    describe('the usual choices, worked out from the first date (Saturday 10 October 2026)', () => {
      it.each([
        ['DAILY', { freq: 'DAILY', interval: 1 }],
        ['WEEKDAYS', { freq: 'WEEKLY', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] }],
        ['WEEKLY', { freq: 'WEEKLY', interval: 1 }],
        ['MONTHLY', { freq: 'MONTHLY', interval: 1 }],
        // the 10th is the 2nd Saturday
        [
          'MONTHLY_NTH',
          { freq: 'MONTHLY', interval: 1, monthly: { kind: 'nth', nth: 2, weekday: 'SA' } },
        ],
        ['YEARLY', { freq: 'YEARLY', interval: 1 }],
      ])('%s', (repeat, rule) => {
        expect(data({ repeat, recurrenceUntil: '2027-03-31' }).repeat).toEqual(rule);
      });

      it('says "the last" when the first date is a 5th weekday of its month', () => {
        // Saturday 31 October 2026 is the 5th Saturday
        expect(
          data({
            repeat: 'MONTHLY_NTH',
            startsAt: '2026-10-31T20:00',
            endsAt: '2026-11-01T02:00',
            recurrenceUntil: '2027-12-31',
          }).repeat,
        ).toEqual({
          freq: 'MONTHLY',
          interval: 1,
          monthly: { kind: 'nth', nth: -1, weekday: 'SA' },
        });
      });

      it('"every weekday" starting on a Saturday starts on the Monday', () => {
        expect(data({ repeat: 'WEEKDAYS', recurrenceUntil: '2026-12-31' }).startsAt).toEqual(
          new Date('2026-10-12T18:00:00Z'),
        );
      });
    });

    describe('custom', () => {
      const custom = (overrides: Partial<RawEventInput>) =>
        parse({ repeat: 'CUSTOM', recurrenceUntil: '2027-12-31', ...overrides });

      it('every 2 weeks on Monday and Wednesday, 10 times', () => {
        const result = custom({
          repeatFreq: 'WEEKLY',
          repeatInterval: '2',
          repeatWeekdays: ['WE', 'MO'],
          repeatEnd: 'count',
          repeatCount: '10',
        });
        expect(result.ok && result.data.repeat).toEqual({
          freq: 'WEEKLY',
          interval: 2,
          weekdays: ['MO', 'WE'],
          count: 10,
        });
        // The first date is a Saturday: the first Monday that counts is the one of the second week (the week of
        // the first date, whose Monday and Wednesday are behind it, is the first of the "every 2 weeks"). The end is
        // the start of the 10th date: Wednesday 16 December, 20:00 in winter time.
        expect(result.ok && result.data.startsAt).toEqual(new Date('2026-10-19T18:00:00Z'));
        expect(result.ok && result.data.recurrenceUntil).toEqual(new Date('2026-12-16T19:00:00Z'));
      });

      it.each(['0', '100', '-1', '1.5', 'abc', ''])(
        'refuses an interval of %j',
        (repeatInterval) => {
          expect(custom({ repeatFreq: 'DAILY', repeatInterval })).toEqual({
            ok: false,
            errors: { repeatInterval: 'intervalInvalid' },
          });
        },
      );

      it('refuses a week with no day, or with a day that does not exist', () => {
        const base = { repeatFreq: 'WEEKLY', repeatInterval: '1' };
        expect(custom({ ...base, repeatWeekdays: [] })).toEqual({
          ok: false,
          errors: { repeatWeekdays: 'weekdaysRequired' },
        });
        expect(custom({ ...base, repeatWeekdays: ['MO', 'XX'] })).toEqual({
          ok: false,
          errors: { repeatWeekdays: 'weekdaysRequired' },
        });
      });

      it('refuses a frequency that does not exist', () => {
        expect(custom({ repeatFreq: 'HOURLY' })).toMatchObject({
          ok: false,
          errors: { repeat: 'invalid' },
        });
      });

      it.each([
        ['day', { kind: 'day', day: 10 }],
        ['nth', { kind: 'nth', nth: 2, weekday: 'SA' }],
        ['last', { kind: 'nth', nth: -1, weekday: 'SA' }],
        ['lastDay', { kind: 'lastDay' }],
      ])('every 3 months, on the %s choice', (repeatMonthly, monthly) => {
        const result = custom({ repeatFreq: 'MONTHLY', repeatInterval: '3', repeatMonthly });
        expect(result.ok && result.data.repeat).toMatchObject({
          freq: 'MONTHLY',
          interval: 3,
          monthly,
        });
      });

      it('every year, on the last day of the month of the first date', () => {
        const result = custom({
          repeatFreq: 'YEARLY',
          repeatInterval: '1',
          repeatMonthly: 'lastDay',
        });
        expect(result.ok && result.data.repeat).toEqual({
          freq: 'YEARLY',
          interval: 1,
          monthly: { kind: 'lastDay' },
        });
        // the first date becomes the last day of October
        expect(result.ok && result.data.startsAt).toEqual(new Date('2026-10-31T19:00:00Z'));
      });

      it('on a day written in the form: the 31st, from a first date that is not the 31st', () => {
        const result = custom({
          repeatFreq: 'MONTHLY',
          repeatInterval: '1',
          repeatMonthly: 'day',
          repeatMonthDay: '31',
        });
        expect(result.ok && result.data.repeat).toMatchObject({
          monthly: { kind: 'day', day: 31 },
        });
      });

      it('refuses "the 2nd Saturday" from a first date that is a 5th Saturday', () => {
        expect(
          custom({
            startsAt: '2026-10-31T20:00',
            endsAt: '2026-11-01T02:00',
            repeatFreq: 'MONTHLY',
            repeatInterval: '1',
            repeatMonthly: 'nth',
          }),
        ).toEqual({ ok: false, errors: { repeatMonthly: 'monthlyUnavailable' } });
      });

      it('refuses a day of the month that does not exist, and a choice that is not one', () => {
        const base = { repeatFreq: 'MONTHLY', repeatInterval: '1' };
        expect(custom({ ...base, repeatMonthly: 'day', repeatMonthDay: '32' })).toMatchObject({
          ok: false,
          errors: { repeatMonthly: 'invalid' },
        });
        expect(custom({ ...base, repeatMonthly: 'fifth' })).toMatchObject({
          ok: false,
          errors: { repeatMonthly: 'invalid' },
        });
      });

      it('refuses a count of 0, of more than an event holds, or that is not a number', () => {
        for (const repeatCount of ['0', String(MAX_OCCURRENCES + 1), 'ten', '']) {
          expect(
            custom({ repeatFreq: 'DAILY', repeatInterval: '1', repeatEnd: 'count', repeatCount }),
          ).toEqual({ ok: false, errors: { repeatCount: 'countInvalid' } });
        }
      });

      it('reports every problem of the repetition at once', () => {
        expect(
          custom({
            repeatFreq: 'WEEKLY',
            repeatInterval: '1',
            repeatWeekdays: [],
            repeatEnd: 'until',
            recurrenceUntil: '',
          }),
        ).toEqual({
          ok: false,
          errors: {
            repeatWeekdays: 'weekdaysRequired',
            recurrenceUntil: 'untilRequired',
          },
        });
      });
    });

    it('moves the first date to the first one that fits, keeps the hour and the duration, and the school year follows', () => {
      const result = parse({
        repeat: 'CUSTOM',
        repeatFreq: 'MONTHLY',
        repeatInterval: '1',
        repeatMonthly: 'day',
        repeatMonthDay: '15',
        startsAt: '2026-08-31T20:00',
        endsAt: '2026-09-01T02:00',
        recurrenceUntil: '2027-01-31',
      });
      expect(result.ok && result.data.startsAt).toEqual(new Date('2026-09-15T18:00:00Z'));
      expect(result.ok && result.data.endsAt).toEqual(new Date('2026-09-16T00:00:00Z'));
      // 31 August is in 2025-2026, 15 September in 2026-2027
      expect(result.ok && result.data.schoolYear).toBe('2026-2027');
    });

    it('keeps the first date typed when it fits', () => {
      expect(data({ repeat: 'WEEKLY', recurrenceUntil: '2026-10-31' }).startsAt).toEqual(
        new Date('2026-10-10T18:00:00Z'),
      );
    });
  });
});
