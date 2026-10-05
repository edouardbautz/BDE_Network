import { describe, expect, it } from 'vitest';
import {
  formatDateTimeRange,
  formatDayHeading,
  formatMonthTitle,
  formatTimeRange,
  weekdayLabels,
} from './format';

const PARIS = 'Europe/Paris';

describe('formatTimeRange', () => {
  it('shows start – end in the BDE timezone for a same-day event', () => {
    // 18:00Z–21:00Z on 10 Oct is 20:00–23:00 in Paris (UTC+2)
    expect(
      formatTimeRange(
        new Date('2026-10-10T18:00:00Z'),
        new Date('2026-10-10T21:00:00Z'),
        'fr',
        PARIS,
      ),
    ).toBe('20:00 – 23:00');
  });

  it('mentions the end day when the event runs past midnight', () => {
    expect(
      formatTimeRange(
        new Date('2026-10-10T18:00:00Z'),
        new Date('2026-10-11T00:00:00Z'),
        'fr',
        PARIS,
      ),
    ).toBe('20:00 → 11 oct., 02:00');
  });

  it('keeps an event ending exactly at midnight on its own day', () => {
    expect(
      formatTimeRange(
        new Date('2026-10-10T18:00:00Z'),
        new Date('2026-10-10T22:00:00Z'),
        'fr',
        PARIS,
      ),
    ).toBe('20:00 – 00:00');
  });
});

describe('formatDateTimeRange', () => {
  it('prefixes the full local date', () => {
    expect(
      formatDateTimeRange(
        new Date('2026-10-10T18:00:00Z'),
        new Date('2026-10-10T21:00:00Z'),
        'fr',
        PARIS,
      ),
    ).toBe('samedi 10 octobre 2026, 20:00 – 23:00');
  });
});

describe('calendar headings', () => {
  it('formats a day heading and capitalised month title per locale', () => {
    expect(formatDayHeading({ year: 2026, month: 10, day: 10 }, 'fr')).toBe('samedi 10 octobre');
    expect(formatDayHeading({ year: 2026, month: 10, day: 10 }, 'en')).toBe('Saturday, October 10');
    expect(formatMonthTitle({ year: 2026, month: 10 }, 'fr')).toBe('Octobre 2026');
    expect(formatMonthTitle({ year: 2026, month: 3 }, 'en')).toBe('March 2026');
  });

  it('lists weekdays Monday first', () => {
    expect(weekdayLabels('en', 'long')).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(weekdayLabels('fr')[0]).toMatch(/^lun/);
  });
});
