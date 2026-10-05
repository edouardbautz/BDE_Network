import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  currentMonth,
  dayKey,
  gridRange,
  groupByLocalDay,
  monthKey,
  parseDayKey,
  parseMonthKey,
  shiftMonth,
} from './calendar';
import type { OccurrenceView } from './occurrences';

const PARIS = 'Europe/Paris';

function occurrence(id: string, start: string, end: string): OccurrenceView {
  return {
    key: id,
    eventId: id,
    title: id,
    description: null,
    location: null,
    categoryKey: 'sport',
    status: 'CONFIRMED',
    start: new Date(start),
    end: new Date(end),
    isRecurring: false,
    schoolYear: '2025-2026',
    updatedAt: new Date(start),
    assignees: [],
  };
}

describe('month parsing', () => {
  it('parses valid keys and rejects invalid ones', () => {
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-1')).toBeNull();
    expect(parseMonthKey(undefined)).toBeNull();
    expect(parseDayKey('2026-02-29')).toBeNull();
    expect(parseDayKey('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
  });

  it('formats keys', () => {
    expect(monthKey({ year: 2026, month: 3 })).toBe('2026-03');
    expect(dayKey({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
  });

  it('reads the current month in the BDE timezone, not UTC', () => {
    // 30 Sep 23:30 UTC is already 1 Oct in Paris.
    expect(currentMonth(new Date('2026-09-30T23:30:00Z'), PARIS)).toEqual({
      year: 2026,
      month: 10,
    });
  });
});

describe('buildMonthGrid', () => {
  it('starts on Monday and always has full weeks', () => {
    // October 2026 starts on a Thursday and has 31 days → 5 weeks.
    const grid = buildMonthGrid({ year: 2026, month: 10 });
    expect(grid).toHaveLength(5);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0]?.[0]?.key).toBe('2026-09-28');
    expect(grid[0]?.[3]?.key).toBe('2026-10-01');
    expect(grid[4]?.[6]?.key).toBe('2026-11-01');
  });

  it('flags days outside the month', () => {
    const grid = buildMonthGrid({ year: 2026, month: 10 });
    expect(grid[0]?.[0]?.inMonth).toBe(false);
    expect(grid[0]?.[3]?.inMonth).toBe(true);
    expect(grid[4]?.[6]?.inMonth).toBe(false);
  });

  it('uses four rows for a February that fits exactly (Feb 2027)', () => {
    const grid = buildMonthGrid({ year: 2027, month: 2 });
    expect(grid).toHaveLength(4);
    expect(grid[0]?.[0]?.key).toBe('2027-02-01');
  });

  it('uses six rows when the month needs them', () => {
    // March 2026 starts on a Sunday → 6 rows.
    expect(buildMonthGrid({ year: 2026, month: 3 })).toHaveLength(6);
  });
});

describe('gridRange', () => {
  it('spans from local midnight of the first cell to local midnight after the last', () => {
    const range = gridRange(buildMonthGrid({ year: 2026, month: 10 }), PARIS);
    // 28 Sep 00:00 Paris (UTC+2) and 2 Nov 00:00 Paris (UTC+1, DST ended 25 Oct)
    expect(range.from.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});

describe('groupByLocalDay', () => {
  it('buckets by the local day, not the UTC day', () => {
    // 23:30 UTC on 10 Oct is 01:30 on 11 Oct in Paris.
    const groups = groupByLocalDay(
      [occurrence('late', '2026-10-10T23:30:00Z', '2026-10-11T00:30:00Z')],
      PARIS,
    );
    expect([...groups.keys()]).toEqual(['2026-10-11']);
  });

  it('shows an event running past midnight on both days', () => {
    const groups = groupByLocalDay(
      [occurrence('party', '2026-10-10T18:00:00Z', '2026-10-11T02:00:00Z')],
      PARIS,
    );
    expect([...groups.keys()]).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('does not spill onto the next day when it ends exactly at midnight', () => {
    const groups = groupByLocalDay(
      [occurrence('exact', '2026-10-10T18:00:00Z', '2026-10-10T22:00:00Z')],
      PARIS,
    );
    // 22:00 UTC = 00:00 Paris on the 11th → still the 10th only.
    expect([...groups.keys()]).toEqual(['2026-10-10']);
  });

  it('covers every day of a multi-day event and keeps order within a day', () => {
    const groups = groupByLocalDay(
      [
        occurrence('a', '2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z'),
        occurrence('wei', '2026-10-09T10:00:00Z', '2026-10-11T10:00:00Z'),
        occurrence('b', '2026-10-10T12:00:00Z', '2026-10-10T13:00:00Z'),
      ],
      PARIS,
    );
    expect([...groups.keys()].sort()).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    expect(groups.get('2026-10-10')?.map((o) => o.eventId)).toEqual(['a', 'wei', 'b']);
  });
});
