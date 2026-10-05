import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatLocalDateInput,
  formatLocalInput,
  fromLocalDateTime,
  parseLocalDateInput,
  parseLocalInput,
  schoolYearOf,
  toLocalDateTime,
} from './time';

const PARIS = 'Europe/Paris';

describe('toLocalDateTime / fromLocalDateTime', () => {
  it('reads UTC as Paris wall clock in winter (UTC+1)', () => {
    expect(toLocalDateTime(new Date('2026-01-15T19:30:00Z'), PARIS)).toEqual({
      year: 2026,
      month: 1,
      day: 15,
      hour: 20,
      minute: 30,
    });
  });

  it('reads UTC as Paris wall clock in summer (UTC+2)', () => {
    expect(toLocalDateTime(new Date('2026-07-15T18:30:00Z'), PARIS).hour).toBe(20);
  });

  it('converts a Paris wall clock back to UTC, winter and summer', () => {
    expect(
      fromLocalDateTime({ year: 2026, month: 1, day: 15, hour: 20, minute: 30 }, PARIS),
    ).toEqual(new Date('2026-01-15T19:30:00Z'));
    expect(
      fromLocalDateTime({ year: 2026, month: 7, day: 15, hour: 20, minute: 30 }, PARIS),
    ).toEqual(new Date('2026-07-15T18:30:00Z'));
  });

  it('works for zones west of UTC and with half-hour offsets', () => {
    const newYork = fromLocalDateTime(
      { year: 2026, month: 1, day: 10, hour: 9, minute: 0 },
      'America/New_York',
    );
    expect(newYork).toEqual(new Date('2026-01-10T14:00:00Z'));
    const kolkata = fromLocalDateTime(
      { year: 2026, month: 1, day: 10, hour: 9, minute: 0 },
      'Asia/Kolkata',
    );
    expect(kolkata).toEqual(new Date('2026-01-10T03:30:00Z'));
  });

  it('round-trips across the whole year, including DST changes', () => {
    for (let day = 0; day < 365; day += 1) {
      const instant = new Date(Date.UTC(2026, 0, 1, 12) + day * 86_400_000);
      const local = toLocalDateTime(instant, PARIS);
      expect(fromLocalDateTime(local, PARIS)).toEqual(instant);
    }
  });

  it('shifts a non-existent spring-forward time one hour later', () => {
    // 29 Mar 2026: 02:00 → 03:00 in Paris, so 02:30 does not exist.
    const resolved = fromLocalDateTime(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      PARIS,
    );
    expect(toLocalDateTime(resolved, PARIS)).toMatchObject({ hour: 3, minute: 30 });
  });
});

describe('local input formatting and parsing', () => {
  it('formats an instant for datetime-local and date inputs in the BDE zone', () => {
    const instant = new Date('2026-07-15T18:05:00Z');
    expect(formatLocalInput(instant, PARIS)).toBe('2026-07-15T20:05');
    expect(formatLocalDateInput(instant, PARIS)).toBe('2026-07-15');
  });

  it('parses valid values', () => {
    expect(parseLocalInput('2026-02-28T23:59')).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 23,
      minute: 59,
    });
    expect(parseLocalDateInput('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it.each(['', '2026-02-30T10:00', '2026-13-01T10:00', '2026-02-10T24:00', '2026-02-10 10:00'])(
    'rejects invalid datetime %j',
    (value) => {
      expect(parseLocalInput(value)).toBeNull();
    },
  );

  it.each(['', '2026-02-30', '26-02-10'])('rejects invalid date %j', (value) => {
    expect(parseLocalDateInput(value)).toBeNull();
  });
});

describe('schoolYearOf', () => {
  it('starts the academic year in September', () => {
    expect(schoolYearOf(new Date('2025-09-01T10:00:00Z'), PARIS)).toBe('2025-2026');
    expect(schoolYearOf(new Date('2025-08-31T10:00:00Z'), PARIS)).toBe('2024-2025');
    expect(schoolYearOf(new Date('2026-06-15T10:00:00Z'), PARIS)).toBe('2025-2026');
  });

  it('uses the local date, not the UTC one, at the boundary', () => {
    // 31 Aug 22:30 UTC is already 1 Sep 00:30 in Paris.
    expect(schoolYearOf(new Date('2025-08-31T22:30:00Z'), PARIS)).toBe('2025-2026');
    expect(schoolYearOf(new Date('2025-08-31T22:30:00Z'), 'UTC')).toBe('2024-2025');
  });
});

describe('addDays', () => {
  it('rolls over months and years', () => {
    expect(addDays({ year: 2026, month: 12, day: 30 }, 5)).toEqual({
      year: 2027,
      month: 1,
      day: 4,
    });
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });
});
