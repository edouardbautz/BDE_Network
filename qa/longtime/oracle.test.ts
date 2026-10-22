import { describe, expect, it } from 'vitest';
import { deliveryTick, instantOf, reminderDue, ticksBetween, wallClock } from './oracle';

const PARIS = 'Europe/Paris';
const iso = (date: Date | null) => date?.toISOString() ?? null;

describe('instantOf and wallClock', () => {
  it('know the offset of Paris in winter and in summer', () => {
    expect(iso(instantOf(2026, 12, 1, 18, PARIS))).toBe('2026-12-01T17:00:00.000Z');
    expect(iso(instantOf(2027, 6, 1, 18, PARIS))).toBe('2027-06-01T16:00:00.000Z');
  });

  it('follow the changes of clock: the clocks go back on 2026-10-25 and forward on 2027-03-28', () => {
    expect(iso(instantOf(2026, 10, 24, 18, PARIS))).toBe('2026-10-24T16:00:00.000Z');
    expect(iso(instantOf(2026, 10, 25, 18, PARIS))).toBe('2026-10-25T17:00:00.000Z');
    expect(iso(instantOf(2027, 3, 27, 18, PARIS))).toBe('2027-03-27T17:00:00.000Z');
    expect(iso(instantOf(2027, 3, 28, 18, PARIS))).toBe('2027-03-28T16:00:00.000Z');
  });

  it('read the wall clock back', () => {
    expect(wallClock(new Date('2026-10-25T00:30:00Z'), PARIS)).toMatchObject({ day: 25, hour: 2 });
    expect(wallClock(new Date('2026-10-25T01:30:00Z'), PARIS)).toMatchObject({ day: 25, hour: 2 });
    expect(wallClock(new Date('2026-12-31T23:30:00Z'), PARIS)).toMatchObject({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
    });
  });

  it('work in a zone ahead of UTC and in one behind it', () => {
    expect(iso(instantOf(2027, 1, 15, 18, 'Pacific/Auckland'))).toBe('2027-01-15T05:00:00.000Z');
    expect(iso(instantOf(2027, 1, 15, 18, 'America/Los_Angeles'))).toBe('2027-01-16T02:00:00.000Z');
  });
});

describe('reminderDue', () => {
  it('is 18:00 on the day before, on the wall clock', () => {
    expect(iso(reminderDue(new Date('2026-12-03T19:00:00Z'), PARIS, 18))).toBe(
      '2026-12-02T17:00:00.000Z',
    );
  });

  it('follows the change of clock between the day before and the date', () => {
    // Sunday 2027-03-28, 00:30 Paris (23:30Z the day before): the reminder is Saturday 18:00, still on winter time.
    expect(iso(reminderDue(new Date('2027-03-27T23:30:00Z'), PARIS, 18))).toBe(
      '2027-03-27T17:00:00.000Z',
    );
    // Sunday 2027-03-28, 12:00 Paris (10:00Z, summer time): Saturday 18:00 is 17:00Z, winter time.
    expect(iso(reminderDue(new Date('2027-03-28T10:00:00Z'), PARIS, 18))).toBe(
      '2027-03-27T17:00:00.000Z',
    );
    // Monday 2027-03-29, 12:00 Paris: the day before is Sunday, already on summer time.
    expect(iso(reminderDue(new Date('2027-03-29T10:00:00Z'), PARIS, 18))).toBe(
      '2027-03-28T16:00:00.000Z',
    );
  });

  it('crosses the end of the month and of the year', () => {
    expect(iso(reminderDue(new Date('2027-01-01T11:00:00Z'), PARIS, 18))).toBe(
      '2026-12-31T17:00:00.000Z',
    );
    expect(iso(reminderDue(new Date('2027-03-01T11:00:00Z'), PARIS, 18))).toBe(
      '2027-02-28T17:00:00.000Z',
    );
  });
});

describe('deliveryTick', () => {
  const ticks = ticksBetween(
    new Date('2026-12-01T00:13:00Z'),
    new Date('2026-12-08T00:00:00Z'),
    4 * 3_600_000,
  );
  const occurrence = (start: string, extra = {}) => ({
    start: new Date(start),
    reminded: true,
    announcedAt: null,
    ...extra,
  });

  it('is the first tick after the reminder is due', () => {
    // due 2026-12-02T17:00Z; the ticks are at 00:13, 04:13, 08:13, 12:13, 16:13, 20:13 …
    expect(iso(deliveryTick(occurrence('2026-12-03T19:00:00Z'), PARIS, 18, ticks))).toBe(
      '2026-12-02T20:13:00.000Z',
    );
  });

  it('is nothing for a date that is not confirmed or is cancelled', () => {
    expect(
      deliveryTick(occurrence('2026-12-03T19:00:00Z', { reminded: false }), PARIS, 18, ticks),
    ).toBeNull();
  });

  it('is nothing for a date confirmed after its reminder was due', () => {
    const announced = new Date('2026-12-02T18:00:00Z');
    expect(
      deliveryTick(
        occurrence('2026-12-03T19:00:00Z', { announcedAt: announced }),
        PARIS,
        18,
        ticks,
      ),
    ).toBeNull();
    const before = new Date('2026-12-02T16:00:00Z');
    expect(
      deliveryTick(occurrence('2026-12-03T19:00:00Z', { announcedAt: before }), PARIS, 18, ticks),
    ).not.toBeNull();
  });

  it('is nothing when no tick falls between the moment it is due and the start (the platform was down)', () => {
    const gap = ticks.filter(
      (tick) =>
        tick.getTime() < Date.parse('2026-12-02T10:00:00Z') ||
        tick.getTime() > Date.parse('2026-12-04T10:00:00Z'),
    );
    expect(deliveryTick(occurrence('2026-12-03T19:00:00Z'), PARIS, 18, gap)).toBeNull();
    // but a date that has not started when the platform comes back is still reminded
    expect(iso(deliveryTick(occurrence('2026-12-04T19:00:00Z'), PARIS, 18, gap))).toBe(
      '2026-12-04T12:13:00.000Z',
    );
  });
});
