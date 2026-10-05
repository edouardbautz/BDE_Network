import { describe, expect, it } from 'vitest';
import type { EventRecurrence } from '@/generated/prisma/client';
import {
  MAX_OCCURRENCES,
  allOccurrences,
  isOccurrenceStart,
  occurrencesInRange,
  type RecurringSource,
} from './recurrence';
import { formatLocalInput } from './time';

const PARIS = 'Europe/Paris';

function source(
  recurrence: EventRecurrence,
  startsAt: string,
  until: string | null,
  durationHours = 2,
): RecurringSource {
  const start = new Date(startsAt);
  return {
    startsAt: start,
    endsAt: new Date(start.getTime() + durationHours * 3_600_000),
    recurrence,
    recurrenceUntil: until ? new Date(until) : null,
  };
}

const localStarts = (occurrences: { start: Date }[]) =>
  occurrences.map((o) => formatLocalInput(o.start, PARIS));

describe('allOccurrences', () => {
  it('returns a single occurrence for a one-off event', () => {
    const one = source('NONE', '2026-05-01T18:00:00Z', null);
    expect(allOccurrences(one, PARIS)).toEqual([{ start: one.startsAt, end: one.endsAt }]);
  });

  it('repeats weekly up to and including the end date', () => {
    const weekly = source('WEEKLY', '2026-05-04T18:00:00Z', '2026-05-25T18:00:00Z');
    expect(allOccurrences(weekly, PARIS)).toHaveLength(4);
  });

  it('does not include an occurrence that starts after the end', () => {
    const weekly = source('WEEKLY', '2026-05-04T18:00:00Z', '2026-05-25T17:59:00Z');
    expect(allOccurrences(weekly, PARIS)).toHaveLength(3);
  });

  it('repeats every two weeks', () => {
    const biweekly = source('BIWEEKLY', '2026-05-04T18:00:00Z', '2026-06-30T18:00:00Z');
    expect(localStarts(allOccurrences(biweekly, PARIS))).toEqual([
      '2026-05-04T20:00',
      '2026-05-18T20:00',
      '2026-06-01T20:00',
      '2026-06-15T20:00',
      '2026-06-29T20:00',
    ]);
  });

  it('keeps the local wall-clock time across the spring DST change', () => {
    // Weekly at 20:00 Paris, from 21 Mar (UTC+1) over 29 Mar (switch to UTC+2).
    const weekly = source('WEEKLY', '2026-03-21T19:00:00Z', '2026-04-11T19:00:00Z');
    const occurrences = allOccurrences(weekly, PARIS);
    expect(localStarts(occurrences)).toEqual([
      '2026-03-21T20:00',
      '2026-03-28T20:00',
      '2026-04-04T20:00',
      '2026-04-11T20:00',
    ]);
    // The UTC instant shifts by one hour once summer time starts.
    expect(occurrences[1]?.start.toISOString()).toBe('2026-03-28T19:00:00.000Z');
    expect(occurrences[2]?.start.toISOString()).toBe('2026-04-04T18:00:00.000Z');
  });

  it('keeps the local wall-clock time across the autumn DST change', () => {
    const weekly = source('WEEKLY', '2026-10-18T18:00:00Z', '2026-11-08T20:00:00Z');
    expect(localStarts(allOccurrences(weekly, PARIS))).toEqual([
      '2026-10-18T20:00',
      '2026-10-25T20:00',
      '2026-11-01T20:00',
      '2026-11-08T20:00',
    ]);
  });

  it('keeps the duration of every occurrence', () => {
    const weekly = source('WEEKLY', '2026-05-04T18:00:00Z', '2026-05-18T18:00:00Z', 3);
    for (const occurrence of allOccurrences(weekly, PARIS)) {
      expect(occurrence.end.getTime() - occurrence.start.getTime()).toBe(3 * 3_600_000);
    }
  });

  it('repeats monthly on the same day', () => {
    const monthly = source('MONTHLY', '2026-01-15T18:00:00Z', '2026-04-30T18:00:00Z');
    expect(localStarts(allOccurrences(monthly, PARIS))).toEqual([
      '2026-01-15T19:00',
      '2026-02-15T19:00',
      '2026-03-15T19:00',
      '2026-04-15T19:00',
    ]);
  });

  it('falls back to the last day of shorter months, then returns to the 31st', () => {
    const monthly = source('MONTHLY', '2026-01-31T11:00:00Z', '2026-05-31T23:00:00Z');
    expect(localStarts(allOccurrences(monthly, PARIS)).map((s) => s.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('rolls monthly series over a year boundary', () => {
    const monthly = source('MONTHLY', '2026-11-10T18:00:00Z', '2027-02-28T18:00:00Z');
    expect(localStarts(allOccurrences(monthly, PARIS)).map((s) => s.slice(0, 10))).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
    ]);
  });

  it('never exceeds MAX_OCCURRENCES', () => {
    const endless = source('WEEKLY', '2026-01-05T18:00:00Z', '2040-01-01T00:00:00Z');
    expect(allOccurrences(endless, PARIS)).toHaveLength(MAX_OCCURRENCES);
  });

  it('treats a recurring event without an end date as a one-off (end is mandatory)', () => {
    expect(allOccurrences(source('WEEKLY', '2026-05-04T18:00:00Z', null), PARIS)).toHaveLength(1);
  });
});

describe('occurrencesInRange', () => {
  const weekly = source('WEEKLY', '2026-05-04T18:00:00Z', '2026-06-29T18:00:00Z');

  it('returns only occurrences overlapping the range', () => {
    const result = occurrencesInRange(weekly, PARIS, {
      from: new Date('2026-05-10T00:00:00Z'),
      to: new Date('2026-05-25T00:00:00Z'),
    });
    expect(result.map((o) => o.start.toISOString())).toEqual([
      '2026-05-11T18:00:00.000Z',
      '2026-05-18T18:00:00.000Z',
    ]);
  });

  it('includes an occurrence that started before the range but ends inside it', () => {
    const result = occurrencesInRange(weekly, PARIS, {
      from: new Date('2026-05-04T19:00:00Z'),
      to: new Date('2026-05-05T00:00:00Z'),
    });
    expect(result).toHaveLength(1);
  });

  it('omits cancelled occurrences without touching the others', () => {
    const cancelled = new Set([new Date('2026-05-11T18:00:00Z').getTime()]);
    const result = occurrencesInRange(
      weekly,
      PARIS,
      { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-05-20T00:00:00Z') },
      cancelled,
    );
    expect(result.map((o) => o.start.toISOString())).toEqual([
      '2026-05-04T18:00:00.000Z',
      '2026-05-18T18:00:00.000Z',
    ]);
  });
});

describe('isOccurrenceStart', () => {
  const weekly = source('WEEKLY', '2026-05-04T18:00:00Z', '2026-06-29T18:00:00Z');

  it('accepts a real occurrence and rejects any other instant', () => {
    expect(isOccurrenceStart(weekly, PARIS, new Date('2026-05-11T18:00:00Z'))).toBe(true);
    expect(isOccurrenceStart(weekly, PARIS, new Date('2026-05-12T18:00:00Z'))).toBe(false);
    expect(isOccurrenceStart(weekly, PARIS, new Date('2026-07-06T18:00:00Z'))).toBe(false);
  });
});
