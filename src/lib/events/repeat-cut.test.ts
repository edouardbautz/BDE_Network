import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  alignStart,
  cutRule,
  endOfCountedRule,
  expandRepeat,
  type MonthlyPattern,
  type RepeatRule,
} from './repeat';
import { fromLocalDateTime, toLocalDateTime } from './time';

// Cutting a series in two ("this one and the following") must leave every date where it was, whatever the rule: the
// dates of the first row followed by the dates of the second are the dates of the series that was cut. Played here on
// rules chosen at random, in several time zones, at every date of each series.

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

const ZONES = ['Europe/Paris', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC'];
const HOUR = 3_600_000;

interface Series {
  rule: RepeatRule;
  startsAt: Date;
  endsAt: Date;
  until: Date;
  zone: string;
}

function randomSeries(next: () => number): Series {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!;
  const freq = pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const);
  const weekdays = [...WEEKDAYS].filter(() => next() < 0.35);
  const rule: RepeatRule = {
    freq,
    interval: pick([1, 1, 2, 3, 5]),
    ...(freq === 'WEEKLY' && weekdays.length > 0 ? { weekdays } : {}),
    ...((freq === 'MONTHLY' || freq === 'YEARLY') && next() < 0.6
      ? {
          monthly: pick<MonthlyPattern>([
            { kind: 'day', day: 1 + Math.floor(next() * 31) },
            { kind: 'lastDay' },
            { kind: 'nth', nth: pick([1, 2, 3, 4, -1] as const), weekday: pick(WEEKDAYS) },
          ]),
        }
      : {}),
    ...(next() < 0.4 ? { count: 2 + Math.floor(next() * 30) } : {}),
  };
  const zone = pick(ZONES);
  const typed = fromLocalDateTime(
    {
      year: 2026 + Math.floor(next() * 3),
      month: 1 + Math.floor(next() * 12),
      day: 1 + Math.floor(next() * 31),
      hour: [0, 5, 9, 12, 18, 20, 23][Math.floor(next() * 7)]!,
      minute: 15 * Math.floor(next() * 4),
    },
    zone,
  );
  const aligned = alignStart(
    rule,
    typed,
    new Date(typed.getTime() + (1 + Math.floor(next() * 4)) * HOUR),
    zone,
  );
  const horizon =
    (rule.freq === 'YEARLY' ? 4000 : rule.freq === 'MONTHLY' ? 900 : 300) * 86_400_000;
  const until =
    endOfCountedRule(rule, aligned.startsAt, aligned.endsAt, zone) ??
    new Date(aligned.startsAt.getTime() + Math.floor(next() * horizon));
  return { rule, ...aligned, until, zone };
}

const starts = (source: Parameters<typeof expandRepeat>[0], zone: string) =>
  expandRepeat(source, zone).occurrences.map((o) => o.start.getTime());

describe('cutRule', () => {
  it(
    'leaves every date where it was, whichever date the series is cut at',
    { timeout: 60_000 },
    () => {
      const next = random(20261017);
      let cuts = 0;
      for (let round = 0; round < 250; round += 1) {
        const series = randomSeries(next);
        const whole = expandRepeat(
          {
            startsAt: series.startsAt,
            endsAt: series.endsAt,
            repeat: series.rule,
            recurrenceUntil: series.until,
          },
          series.zone,
        ).occurrences;
        if (whole.length < 2) continue;

        const first = toLocalDateTime(series.startsAt, series.zone);
        // every date of a short series, a spread of them in a long one
        const step = Math.max(1, Math.floor(whole.length / 12));
        for (let index = 1; index < whole.length; index += step) {
          const { head, tail } = cutRule(series.rule, first, index);
          const cut = whole[index]!;
          const label = `${JSON.stringify(series.rule)} ${series.zone} ${series.startsAt.toISOString()} cut at ${index}`;

          const before = starts(
            {
              startsAt: series.startsAt,
              endsAt: series.endsAt,
              repeat: head,
              // the row stops at its last date (a counted series), or just before the cut
              recurrenceUntil:
                head.count !== undefined
                  ? whole[index - 1]!.start
                  : new Date(cut.start.getTime() - 1),
            },
            series.zone,
          );
          const after = starts(
            {
              startsAt: cut.start,
              endsAt: cut.end,
              repeat: tail,
              recurrenceUntil: series.until,
            },
            series.zone,
          );
          expect([...before, ...after], label).toEqual(whole.map((o) => o.start.getTime()));
          cuts += 1;
        }
      }
      // the property was played, not skipped
      expect(cuts).toBeGreaterThan(1000);
    },
  );

  it('keeps the hour of the series after a cut, outside the hour that a change of clock skips', () => {
    // 02:15 every day in Auckland; clocks go forward on 24 September 2028, when 02:15 does not exist
    const zone = 'Pacific/Auckland';
    const startsAt = fromLocalDateTime(
      { year: 2028, month: 9, day: 22, hour: 2, minute: 15 },
      zone,
    );
    const endsAt = new Date(startsAt.getTime() + HOUR);
    const rule: RepeatRule = { freq: 'DAILY', interval: 1 };
    const until = new Date(startsAt.getTime() + 5 * 86_400_000);
    const whole = expandRepeat({ startsAt, endsAt, repeat: rule, recurrenceUntil: until }, zone);
    const local = (date: Date) => toLocalDateTime(date, zone);

    // the date itself is an hour later, as in every calendar; the others keep 02:15
    expect(whole.occurrences.map((o) => local(o.start).hour)).toEqual([2, 2, 3, 2, 2, 2]);

    // Cut on the date that is an hour later: its row starts at 03:15 and the dates after it follow that hour. A row
    // holds one instant for its first date, and 02:15 does not exist on that day. Cut anywhere else, nothing moves.
    const gap = whole.occurrences[2]!;
    const after = expandRepeat(
      { startsAt: gap.start, endsAt: gap.end, repeat: rule, recurrenceUntil: until },
      zone,
    );
    expect(after.occurrences.map((o) => local(o.start).hour)).toEqual([3, 3, 3, 3]);
  });

  it('shares the number of dates: the first row keeps those before the cut, the second the others', () => {
    const rule: RepeatRule = { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 };
    const first = { year: 2026, month: 10, day: 19 };
    expect(cutRule(rule, first, 4)).toEqual({
      head: { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 4 },
      tail: { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 6 },
    });
  });

  it('writes the day of the month that the second row would no longer find in its first date', () => {
    // a monthly series on the 31st, cut on the 28th of February: the second row starts on the 28th
    const { head, tail } = cutRule(
      { freq: 'MONTHLY', interval: 1 },
      { year: 2027, month: 1, day: 31 },
      1,
    );
    expect(head).toEqual({ freq: 'MONTHLY', interval: 1 });
    expect(tail).toEqual({ freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 31 } });
  });

  it('keeps a pattern the rule wrote, and does not invent one for a week or a day', () => {
    const pattern: RepeatRule = {
      freq: 'MONTHLY',
      interval: 1,
      monthly: { kind: 'nth', nth: 2, weekday: 'TU' },
    };
    expect(cutRule(pattern, { year: 2026, month: 10, day: 13 }, 2).tail).toEqual(pattern);
    for (const freq of ['DAILY', 'WEEKLY'] as const) {
      const rule: RepeatRule = { freq, interval: 1 };
      expect(cutRule(rule, { year: 2026, month: 10, day: 13 }, 2)).toEqual({
        head: rule,
        tail: rule,
      });
    }
  });
});
