// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { archiveName, parseArchiveName } from './names';
import { planRetention, type Entry } from './retention';
import { BACKUP_HOUR, isDue, isStale, slotOf } from './schedule';

const PARIS = 'Europe/Paris';
const at = (iso: string) => new Date(iso);
const entry = (iso: string): Entry => ({ name: archiveName(at(iso)), at: at(iso) });

describe('the name of an automatic backup', () => {
  it('carries the moment in UTC and reads back to it', () => {
    const moment = at('2026-10-27T02:00:04Z');
    expect(archiveName(moment)).toBe('bde-auto-2026-10-27_02-00-04Z.tar.gz');
    expect(parseArchiveName(archiveName(moment))?.toISOString()).toBe(moment.toISOString());
  });

  it.each([
    'bde-backup-2026-10-27_02-00-04.tar.gz', // the script's, never ours
    'bde-auto-2026-10-27_02-00-04Z.tar.gz.enc', // a download
    'bde-auto-2026-02-31_02-00-04Z.tar.gz', // a day that does not exist
    '../bde-auto-2026-10-27_02-00-04Z.tar.gz', // a path
    'bde-auto-2026-10-27_25-00-04Z.tar.gz',
    '',
  ])('does not take "%s" for one', (name) => {
    expect(parseArchiveName(name)).toBeNull();
  });
});

describe('what the rotation keeps: 7 daily, 4 weekly, 6 monthly', () => {
  const nightly = (from: string, days: number): Entry[] =>
    Array.from({ length: days }, (_, index) =>
      entry(new Date(at(from).getTime() + index * 86_400_000).toISOString()),
    );

  /** What a server that makes one backup a night holds after `days` nights, the rotation applied after each. */
  function after(days: number): Entry[] {
    let held: Entry[] = [];
    for (const night of nightly('2026-01-01T02:00:00Z', days)) {
      held = [...held, night];
      const { remove } = planRetention(held, PARIS);
      held = held.filter((item) => !remove.includes(item.name));
    }
    return held;
  }

  it('keeps everything while there are fewer than 8 days', () => {
    expect(planRetention(nightly('2026-10-01T02:00:00Z', 5), PARIS).remove).toEqual([]);
  });

  it('keeps the 7 most recent days and the first backup of the weeks and months before', () => {
    const all = nightly('2026-10-01T02:00:00Z', 30); // Oct 1 to Oct 30
    const { keep, remove } = planRetention(all, PARIS);
    const kept = (iso: string) => keep.has(archiveName(at(iso)));
    expect(kept('2026-10-30T02:00:00Z')).toBe(true); // today
    expect(kept('2026-10-24T02:00:00Z')).toBe(true); // 7th day back
    expect(kept('2026-10-23T02:00:00Z')).toBe(false); // 8th: not a first of anything
    expect(kept('2026-10-19T02:00:00Z')).toBe(true); // Monday: the first of its week
    expect(kept('2026-10-12T02:00:00Z')).toBe(true);
    expect(kept('2026-10-05T02:00:00Z')).toBe(true);
    expect(kept('2026-10-01T02:00:00Z')).toBe(true); // the first of the month (also the first of its week)
    expect(keep.get(archiveName(at('2026-10-30T02:00:00Z')))).toContain('daily');
    expect(keep.get(archiveName(at('2026-10-19T02:00:00Z')))).toEqual(['weekly']);
    expect(remove.length).toBe(30 - keep.size);
  });

  it('settles at 7 + 4 + 6 at most after more than a year of nights', () => {
    const held = after(420);
    expect(held.length).toBeLessThanOrEqual(17);
    expect(held.length).toBeGreaterThanOrEqual(13);
  });

  it('holds on to the first backup of each of the last six months, night after night', () => {
    const held = after(420);
    const firsts = new Set(held.map((item) => item.at.toISOString().slice(0, 10)));
    // 420 nights from 2026-01-01 end on 2027-02-24: the months of 2026-09 to 2027-02 each keep their first night
    for (const day of [
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]) {
      expect(firsts.has(day)).toBe(true);
    }
    expect(firsts.has('2026-08-01')).toBe(false); // the seventh month back is gone
  });

  it('never throws away the newest backup', () => {
    for (const days of [1, 2, 9, 40, 200]) {
      const held = after(days);
      const newest = held.at(-1)!;
      expect(planRetention(held, PARIS).keep.has(newest.name)).toBe(true);
    }
  });

  it('counts the days that have a backup: a server off for a month still keeps 7 days', () => {
    const before = nightly('2026-06-01T02:00:00Z', 10);
    const later = nightly('2026-09-01T02:00:00Z', 10);
    const { keep } = planRetention([...before, ...later], PARIS);
    for (const item of later.slice(3)) expect(keep.has(item.name)).toBe(true);
    // June is still a month of the six, and its first night is the one kept; the other nights of June are not
    expect(keep.get(before[0]!.name)).toContain('monthly');
    expect(keep.has(before[3]!.name)).toBe(false);
  });

  it('reads the days of the BDE, not UTC: 23:30 UTC in Paris is already tomorrow', () => {
    // 22:30Z and 23:30Z of the 27th are 23:30 on the 27th and 00:30 on the 28th in Paris (UTC+1 after the clocks went back):
    // two days of the BDE, one in UTC
    const { keep } = planRetention(
      [entry('2026-10-27T22:30:00Z'), entry('2026-10-27T23:30:00Z')],
      PARIS,
      { daily: 2, weekly: 0, monthly: 0 },
    );
    expect(keep.size).toBe(2);
  });

  it('handles nothing, and one', () => {
    expect(planRetention([], PARIS)).toEqual({ keep: new Map(), remove: [] });
    expect(planRetention([entry('2026-10-27T02:00:00Z')], PARIS).remove).toEqual([]);
  });

  it('puts a week from Monday to Sunday, the first night of the week being the weekly one', () => {
    // Wednesday 21 to Tuesday 27 October, then the next days: the week of Monday 19 and the one of Monday 26
    const { keep } = planRetention(
      [entry('2026-10-21T02:00:00Z'), entry('2026-10-26T02:00:00Z'), entry('2026-10-27T02:00:00Z')],
      PARIS,
      { daily: 0, weekly: 4, monthly: 0 },
    );
    expect([...keep.keys()].sort()).toEqual(
      [archiveName(at('2026-10-21T02:00:00Z')), archiveName(at('2026-10-26T02:00:00Z'))].sort(),
    );
  });
});

describe('when a backup is due', () => {
  const now = (iso: string) => at(iso);

  it('is at 03:00 in the zone of the BDE', () => {
    expect(BACKUP_HOUR).toBe(3);
    expect(slotOf(now('2026-10-27T10:00:00Z'), PARIS).toISOString()).toBe(
      '2026-10-27T02:00:00.000Z',
    ); // CET (UTC+1)
    expect(slotOf(now('2026-07-15T10:00:00Z'), PARIS).toISOString()).toBe(
      '2026-07-15T01:00:00.000Z',
    ); // CEST (UTC+2)
  });

  it('is not due before 03:00', () => {
    expect(isDue({ now: now('2026-10-27T01:59:00Z'), timeZone: PARIS, attempts: [] })).toEqual({
      due: false,
      why: 'early',
    });
  });

  it('is due from 03:00 on, with nothing done since', () => {
    expect(isDue({ now: now('2026-10-27T02:00:00Z'), timeZone: PARIS, attempts: [] })).toEqual({
      due: true,
    });
  });

  it('catches up when the platform was off at 03:00', () => {
    expect(isDue({ now: now('2026-10-27T15:00:00Z'), timeZone: PARIS, attempts: [] })).toEqual({
      due: true,
    });
  });

  it('is done once a backup succeeded since 03:00, even one made by hand at 10:00', () => {
    const attempts = [{ at: now('2026-10-27T09:00:00Z'), ok: true }];
    expect(isDue({ now: now('2026-10-27T15:00:00Z'), timeZone: PARIS, attempts })).toEqual({
      due: false,
      why: 'done',
    });
  });

  it("is still due after a backup made by hand at 01:00 (before the night's)", () => {
    const attempts = [{ at: now('2026-10-27T00:00:00Z'), ok: true }];
    expect(isDue({ now: now('2026-10-27T02:05:00Z'), timeZone: PARIS, attempts })).toEqual({
      due: true,
    });
  });

  it('tries again 30 minutes after a failure, three times in a day, then gives up until tomorrow', () => {
    const fail = (iso: string) => ({ at: now(iso), ok: false });
    expect(
      isDue({
        now: now('2026-10-27T02:20:00Z'),
        timeZone: PARIS,
        attempts: [fail('2026-10-27T02:00:00Z')],
      }),
    ).toEqual({
      due: false,
      why: 'retry-later',
    });
    expect(
      isDue({
        now: now('2026-10-27T02:31:00Z'),
        timeZone: PARIS,
        attempts: [fail('2026-10-27T02:00:00Z')],
      }),
    ).toEqual({
      due: true,
    });
    const three = [
      fail('2026-10-27T02:00:00Z'),
      fail('2026-10-27T02:31:00Z'),
      fail('2026-10-27T03:02:00Z'),
    ];
    expect(isDue({ now: now('2026-10-27T20:00:00Z'), timeZone: PARIS, attempts: three })).toEqual({
      due: false,
      why: 'gave-up',
    });
    // the next night starts again
    expect(isDue({ now: now('2026-10-28T02:00:00Z'), timeZone: PARIS, attempts: three })).toEqual({
      due: true,
    });
  });
});

describe('"no backup succeeded for two days"', () => {
  const since = at('2026-10-01T00:00:00Z');
  it('is false at 47 hours and true at 48', () => {
    const last = at('2026-10-25T02:00:00Z');
    expect(isStale({ now: at('2026-10-27T01:00:00Z'), lastSuccessAt: last, since })).toBe(false);
    expect(isStale({ now: at('2026-10-27T02:00:00Z'), lastSuccessAt: last, since })).toBe(true);
  });

  it('counts from the first start when there never was one', () => {
    expect(isStale({ now: at('2026-10-02T12:00:00Z'), lastSuccessAt: null, since })).toBe(false);
    expect(isStale({ now: at('2026-10-03T00:00:00Z'), lastSuccessAt: null, since })).toBe(true);
  });
});
