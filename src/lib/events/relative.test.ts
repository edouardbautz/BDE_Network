import { describe, expect, it } from 'vitest';
import { daysFromToday } from './relative';

const PARIS = 'Europe/Paris';
const at = (iso: string) => new Date(iso);

describe('daysFromToday', () => {
  it('counts calendar days on the wall clock of the zone, not spans of 24 hours', () => {
    // 22:30 in Paris on the 22nd (20:30Z) and 00:10 on the 23rd (22:10Z): 100 minutes apart, one day apart
    expect(daysFromToday(at('2026-10-22T22:10:00Z'), at('2026-10-22T20:30:00Z'), PARIS)).toBe(1);
    expect(daysFromToday(at('2026-10-22T20:45:00Z'), at('2026-10-22T09:00:00Z'), PARIS)).toBe(0);
  });

  it('is negative for a day that has passed', () => {
    expect(daysFromToday(at('2026-10-20T12:00:00Z'), at('2026-10-22T12:00:00Z'), PARIS)).toBe(-2);
  });

  it('counts across a change of clock', () => {
    // 2026-10-25 is the night the clocks go back in Paris: from the 24th to the 26th is still two days
    expect(daysFromToday(at('2026-10-26T12:00:00Z'), at('2026-10-24T12:00:00Z'), PARIS)).toBe(2);
  });

  it('is not the day of the server', () => {
    // 23:30Z on the 22nd is already the 23rd in Paris, still the 22nd in Auckland's past... and Los Angeles
    expect(daysFromToday(at('2026-10-22T23:30:00Z'), at('2026-10-22T12:00:00Z'), PARIS)).toBe(1);
    expect(
      daysFromToday(at('2026-10-22T23:30:00Z'), at('2026-10-22T12:00:00Z'), 'America/Los_Angeles'),
    ).toBe(0);
  });
});
