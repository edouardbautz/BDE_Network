import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandRepeat, readRepeatRule } from '../../src/lib/events/repeat';
import { checkInvariants, describeViolations } from '../invariants';
import { ADMIN_URL, createMigratedDatabase, type TestDatabase } from '../test-database';
import { CURRENT, CURRENT_DATES, CURRENT_EVENTS, fixtureSqlCurrent } from './fixture-proposals';

/**
 * The data of a board of version 1.3.0 or 1.4.0 says what it claims: every series has the dates its comment names (read by the
 * engine of the repository, which does not move a series saved by the previous one), a counted series ends on the start of its
 * last date, and, on a real PostgreSQL with every migration applied, the whole of it satisfies the invariants of the database. A
 * fixture that breaks them would make the update suite compare what no platform could hold.
 */

const ZONE = 'Europe/Paris';

const datesOf = (id: string): string[] => {
  const event = CURRENT_EVENTS.find((candidate) => candidate.id === id);
  if (!event?.repeat || !event.until) throw new Error(`${id} is not a series`);
  const rule = readRepeatRule(event.repeat);
  if (!rule) throw new Error(`${id} has no readable rule`);
  const { occurrences, truncated } = expandRepeat(
    {
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
      repeat: rule,
      recurrenceUntil: new Date(event.until),
    },
    ZONE,
  );
  expect(truncated).toBe(false);
  return occurrences.map((occurrence) => occurrence.start.toISOString().slice(0, 16));
};

describe('the dates of the series of the 1.3.0 / 1.4.0 fixture', () => {
  it('every two weeks on Monday and Wednesday, ten times, across the change of clock', () => {
    expect(datesOf('upg2-e2')).toEqual([
      '2027-02-01T19:00',
      '2027-02-03T19:00',
      '2027-02-15T19:00',
      '2027-02-17T19:00',
      '2027-03-01T19:00',
      '2027-03-03T19:00',
      '2027-03-15T19:00',
      '2027-03-17T19:00',
      '2027-03-29T18:00',
      '2027-03-31T18:00',
    ]);
  });

  it('the second Saturday, the last day, and every year', () => {
    expect(datesOf('upg2-e3')).toEqual([
      '2027-02-13T15:00',
      '2027-03-13T15:00',
      '2027-04-10T14:00',
      '2027-05-08T14:00',
      '2027-06-12T14:00',
    ]);
    expect(datesOf('upg2-e4')).toEqual([
      '2027-02-28T17:00',
      '2027-03-31T16:00',
      '2027-04-30T16:00',
      '2027-05-31T16:00',
      '2027-06-30T16:00',
    ]);
    expect(datesOf('upg2-e5')).toEqual([
      '2027-02-20T19:00',
      '2028-02-20T19:00',
      '2029-02-20T19:00',
    ]);
  });

  it('a series cut in two keeps the dates of the whole: three and three, Wednesday after Wednesday', () => {
    expect([...datesOf('upg2-e6'), ...datesOf('upg2-e6-b')]).toEqual([
      '2027-05-05T17:00',
      '2027-05-12T17:00',
      '2027-05-19T17:00',
      '2027-05-26T17:00',
      '2027-06-02T17:00',
      '2027-06-09T17:00',
    ]);
  });

  it('the proposed series and the draft series have the dates their counts say', () => {
    expect(datesOf('upg2-e9')).toHaveLength(5);
    expect(datesOf('upg2-e7')).toHaveLength(4);
  });

  it('a counted series ends on the start of its last date', () => {
    for (const event of CURRENT_EVENTS) {
      const rule = event.repeat ? readRepeatRule(event.repeat) : null;
      if (!rule?.count) continue;
      const dates = datesOf(event.id);
      expect(dates, event.id).toHaveLength(rule.count);
      expect(event.until?.slice(0, 16), event.id).toBe(dates[dates.length - 1]);
    }
  });

  it('every date of its own is a date of its series', () => {
    for (const reference of Object.values(CURRENT_DATES)) {
      expect(datesOf(reference.event), reference.event).toContain(reference.start.slice(0, 16));
    }
  });

  it('holds every kind the proposal circuit has: a proposal, a refusal with its comment, a draft', () => {
    const byStatus = (status: string) => CURRENT_EVENTS.filter((event) => event.status === status);
    expect(byStatus('PROPOSED').map((event) => event.id)).toEqual([
      CURRENT.events.proposal,
      CURRENT.events.proposalSeries,
    ]);
    expect(CURRENT_EVENTS.find((event) => event.refused)?.id).toBe(CURRENT.events.refused);
    expect(CURRENT.refusalComment).toContain('\n');
    expect(byStatus('DRAFT').length).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(!ADMIN_URL)(
  'the fixture of the 1.3.0 / 1.4.0 boards on a migrated PostgreSQL',
  () => {
    let database: TestDatabase;
    beforeAll(async () => {
      database = await createMigratedDatabase();
    });
    afterAll(async () => {
      await database?.drop();
    });

    it('loads, and satisfies every invariant of the database', async () => {
      await database.client.query(fixtureSqlCurrent());
      const violations = await checkInvariants(database.client);
      expect(describeViolations(violations)).toBe('');
      const counts = await database.client.query(
        `SELECT (SELECT count(*) FROM "Event")::int AS events, (SELECT count(*) FROM "Role" WHERE "id" LIKE 'role-upg-%')::int AS roles, (SELECT count(*) FROM "EventOccurrence")::int AS dates`,
      );
      expect(counts.rows[0]).toEqual({ events: CURRENT_EVENTS.length, roles: 3, dates: 2 });
    });
  },
);
