// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cancelHrefFor, defaultEventTimes, requestedEventDay } from './defaults';

const PARIS = 'Europe/Paris';

describe('requestedEventDay', () => {
  it('reads a real day', () => {
    expect(requestedEventDay('2026-10-20')).toEqual({ year: 2026, month: 10, day: 20 });
    expect(requestedEventDay(['2026-10-20', '2027-01-01'])).toEqual({
      year: 2026,
      month: 10,
      day: 20,
    });
  });

  it('keeps a day in the past: an event can be recorded after the fact', () => {
    expect(requestedEventDay('2025-01-02')).toEqual({ year: 2025, month: 1, day: 2 });
  });

  it.each([
    undefined,
    '',
    'tomorrow',
    '2026-13-01',
    '2026-02-30',
    '2026-1-5',
    '20261020',
    '2026-10-20T18:00',
    '1999-12-31',
    '2101-01-01',
    '0000-01-01',
    '<script>',
  ])('ignores %j', (value) => {
    expect(requestedEventDay(value)).toBeNull();
  });
});

describe('defaultEventTimes', () => {
  const now = new Date('2026-10-15T10:00:00Z');

  it('is tomorrow 18:00–20:00 in the BDE time zone without a day', () => {
    expect(defaultEventTimes(now, PARIS, null)).toEqual({
      startsAt: '2026-10-16T18:00',
      endsAt: '2026-10-16T20:00',
    });
  });

  it('is 18:00–20:00 on the day asked for', () => {
    expect(defaultEventTimes(now, PARIS, { year: 2026, month: 11, day: 7 })).toEqual({
      startsAt: '2026-11-07T18:00',
      endsAt: '2026-11-07T20:00',
    });
  });

  it('is the BDE’s wall clock, whatever the time zone of the server or of the browser', () => {
    // 23:30 UTC on the 15th is already the 16th in Paris, and the 16th 12:30 in Auckland, the 15th in Los Angeles
    const lateEvening = new Date('2026-10-15T23:30:00Z');
    expect(defaultEventTimes(lateEvening, PARIS, null).startsAt).toBe('2026-10-17T18:00');
    expect(defaultEventTimes(lateEvening, 'Pacific/Auckland', null).startsAt).toBe(
      '2026-10-17T18:00',
    );
    expect(defaultEventTimes(lateEvening, 'America/Los_Angeles', null).startsAt).toBe(
      '2026-10-16T18:00',
    );
  });

  it('stays 18:00 local on the days the clocks change', () => {
    expect(defaultEventTimes(now, PARIS, { year: 2026, month: 3, day: 29 })).toEqual({
      startsAt: '2026-03-29T18:00',
      endsAt: '2026-03-29T20:00',
    });
    expect(defaultEventTimes(now, PARIS, { year: 2026, month: 10, day: 25 })).toEqual({
      startsAt: '2026-10-25T18:00',
      endsAt: '2026-10-25T20:00',
    });
  });
});

describe('cancelHrefFor', () => {
  it('goes back to the day of the calendar the form was opened from', () => {
    expect(cancelHrefFor({ year: 2026, month: 10, day: 20 })).toBe(
      '/events?view=calendar&month=2026-10&day=2026-10-20',
    );
  });

  it('goes back to the list otherwise', () => {
    expect(cancelHrefFor(null)).toBe('/events');
  });
});
