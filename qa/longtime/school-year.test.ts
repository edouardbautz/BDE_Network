import { describe, expect, it } from 'vitest';
import { schoolYearOf } from '@/lib/events/time';
import { instantOf, wallClock } from './oracle';

/**
 * The school year of an instant, around the first of September of every year to 2032, in zones on both sides of UTC (and one
 * with a half-hour offset): the year changes at midnight on the wall clock of the BDE, not at midnight UTC, and not at any
 * other moment. Worked out from `Intl` alone (`oracle.ts`), minute by minute at the boundary and every half hour around it.
 */

const ZONES = ['Europe/Paris', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC'];
const MINUTE = 60_000;

function expectedYear(instant: Date, timeZone: string): string {
  const { year, month } = wallClock(instant, timeZone);
  const start = month >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}

describe('the school year changes at midnight, on the wall clock of the BDE, on the first of September', () => {
  for (const zone of ZONES) {
    it(`in ${zone}, minute by minute at the boundary, every year`, () => {
      for (let year = 2026; year <= 2032; year += 1) {
        const midnight = instantOf(year, 9, 1, 0, zone);
        expect(
          schoolYearOf(new Date(midnight.getTime() - MINUTE), zone),
          `${year}, a minute before`,
        ).toBe(`${year - 1}-${year}`);
        expect(schoolYearOf(midnight, zone), `${year}, at midnight`).toBe(`${year}-${year + 1}`);
        expect(
          schoolYearOf(new Date(midnight.getTime() + MINUTE), zone),
          `${year}, a minute after`,
        ).toBe(`${year}-${year + 1}`);
      }
    });

    it(`in ${zone}, every half hour for two days around it, and over the whole year`, () => {
      const problems: string[] = [];
      for (let year = 2026; year <= 2032; year += 1) {
        const midnight = instantOf(year, 9, 1, 0, zone).getTime();
        for (
          let at = midnight - 24 * 3_600_000;
          at <= midnight + 24 * 3_600_000;
          at += 30 * MINUTE
        ) {
          const instant = new Date(at);
          if (schoolYearOf(instant, zone) !== expectedYear(instant, zone))
            problems.push(`${instant.toISOString()}: ${schoolYearOf(instant, zone)}`);
        }
        // and one instant a day for the whole school year after, which crosses the changes of clock and the new year
        for (let day = 0; day < 365; day += 1) {
          const instant = new Date(midnight + day * 86_400_000 + 7 * 3_600_000);
          if (schoolYearOf(instant, zone) !== expectedYear(instant, zone))
            problems.push(`${instant.toISOString()}: ${schoolYearOf(instant, zone)}`);
        }
      }
      expect(problems.slice(0, 5), `${problems.length} differences`).toEqual([]);
    });
  }
});
