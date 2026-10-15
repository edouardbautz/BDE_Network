import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventRecord, OverrideRecord } from './series';

/**
 * What the calendar feeds say about a series whose dates were edited, moved, put back to draft or handed to the
 * second row of a cut series, from the stored rows to the .ics text: one entry per date, the same identifier
 * whatever happens to the date, and no draft in the BDE feed.
 */

const BDE_TOKEN = 'B'.repeat(43);

vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    bde: { name: 'BDE Test', timezone: 'Europe/Paris' },
    modules: { enabled: ['events'] },
    events: { categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }], reminderHour: 18 },
  })),
}));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));

const stored = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bdeCalendarFeed: { findUnique: vi.fn(async () => ({ id: 'bde' })) },
    // The query's own filter is not evaluated here: the feeds must hold without it (the code decides again).
    event: { findMany: vi.fn(async () => stored.events) },
  },
}));

const { buildBdeSubscriptionFeed, buildCalendarIcs } = await import('./export');
const { expandEvents } = await import('./occurrences');

const hours = (n: number) => n * 3_600_000;
const OCT5 = new Date('2026-10-05T16:00:00Z');
const OCT12 = new Date('2026-10-12T16:00:00Z');
const OCT19 = new Date('2026-10-19T16:00:00Z');
const OCT26 = new Date('2026-10-26T17:00:00Z');
const NOW = new Date('2026-10-01T10:00:00Z');
const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') };

function weekly(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'evt',
    title: 'Training',
    description: 'Weekly training',
    location: 'Gym',
    categoryKey: 'sport',
    status: 'CONFIRMED',
    startsAt: OCT5,
    endsAt: new Date(OCT5.getTime() + hours(2)),
    recurrence: 'WEEKLY',
    recurrenceUntil: new Date('2026-10-31T22:00:00Z'),
    schoolYear: '2026-2027',
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    assignees: [],
    cancellations: [],
    occurrences: [],
    ...overrides,
  };
}

function own(occurrenceStart: Date, values: Partial<OverrideRecord>): OverrideRecord {
  return {
    occurrenceStart,
    title: null,
    description: null,
    location: null,
    categoryKey: null,
    status: null,
    startsAt: null,
    endsAt: null,
    assigneesOverridden: false,
    confirmationNotifiedAt: null,
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    assignees: [],
    ...values,
  };
}

const feedOf = (events: EventRecord[], includeDrafts = true) =>
  buildCalendarIcs(
    expandEvents(events, { timeZone: 'Europe/Paris', range: RANGE, includeDrafts }),
    NOW,
  );
const uids = (ics: string) => [...ics.matchAll(/^UID:(.*)$/gm)].map((m) => m[1]);
const entryOf = (ics: string, uid: string) =>
  ics.split('BEGIN:VEVENT').find((block) => block.includes(`UID:${uid}`)) ?? '';

const UID = (key: string, start: Date) =>
  `${key}-${start.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z@bde-network`;

beforeEach(() => {
  stored.events = [];
});

describe('a date edited on its own', () => {
  const before = feedOf([weekly()]);
  const after = feedOf([
    weekly({
      occurrences: [own(OCT12, { location: 'Pool', title: 'Derby' })],
    }),
  ]);

  it('is the same entry with its new values: replaced by the calendar client, never doubled', () => {
    expect(uids(after)).toEqual(uids(before));
    expect(uids(after)).toHaveLength(4);
    const entry = entryOf(after, UID('evt', OCT12));
    expect(entry).toContain('SUMMARY:Derby');
    expect(entry).toContain('LOCATION:Pool');
    expect(entry).toContain('LAST-MODIFIED:20260920T000000Z');
    // The other dates are untouched.
    expect(entryOf(after, UID('evt', OCT19))).toContain('LOCATION:Gym');
  });

  it('a moved date keeps its identifier and shows its new time', () => {
    const moved = feedOf([
      weekly({
        occurrences: [
          own(OCT12, {
            startsAt: new Date('2026-10-13T17:00:00Z'),
            endsAt: new Date('2026-10-13T18:00:00Z'),
          }),
        ],
      }),
    ]);

    expect(uids(moved)).toEqual(uids(before));
    expect(entryOf(moved, UID('evt', OCT12))).toContain('DTSTART:20261013T170000Z');
  });
});

describe('a date put back to draft', () => {
  const events = () => [weekly({ occurrences: [own(OCT12, { status: 'DRAFT' })] })];

  it('is in the feed of a member who manages events, as tentative', () => {
    const ics = feedOf(events());
    expect(uids(ics)).toHaveLength(4);
    expect(entryOf(ics, UID('evt', OCT12))).toContain('STATUS:TENTATIVE');
    expect(entryOf(ics, UID('evt', OCT19))).toContain('STATUS:CONFIRMED');
  });

  it('is gone from the feed of everybody else', () => {
    const ics = feedOf(events(), false);
    expect(uids(ics)).toEqual([UID('evt', OCT5), UID('evt', OCT19), UID('evt', OCT26)]);
  });

  it('is gone from the BDE feed, which never holds a draft', async () => {
    stored.events = events();
    const ics = await buildBdeSubscriptionFeed(BDE_TOKEN, NOW);

    expect(ics).not.toBeNull();
    expect(uids(ics!)).toEqual([UID('evt', OCT5), UID('evt', OCT19), UID('evt', OCT26)]);
    expect(ics).not.toContain('TENTATIVE');
  });

  it('a draft series with one date confirmed alone has only that date in the BDE feed', async () => {
    stored.events = [
      weekly({ status: 'DRAFT', occurrences: [own(OCT12, { status: 'CONFIRMED' })] }),
    ];
    const ics = await buildBdeSubscriptionFeed(BDE_TOKEN, NOW);

    expect(uids(ics!)).toEqual([UID('evt', OCT12)]);
  });
});

describe('a series cut in two rows', () => {
  const whole = weekly();
  const head = weekly({ recurrenceUntil: OCT12 });
  const tail = weekly({
    id: 'tail',
    seriesId: 'evt',
    startsAt: OCT19,
    endsAt: new Date(OCT19.getTime() + hours(2)),
    location: 'Pool',
  });

  it('keeps every date under the identifier it had before the cut: one entry each, no doubles', () => {
    const cut = feedOf([head, tail]);

    expect(uids(cut)).toEqual(uids(feedOf([whole])));
    expect(entryOf(cut, UID('evt', OCT26))).toContain('LOCATION:Pool');
    expect(entryOf(cut, UID('evt', OCT12))).toContain('LOCATION:Gym');
  });

  it('shows each date once in the pages too: the second row holds the dates from the cut on', () => {
    const views = expandEvents([head, tail], {
      timeZone: 'Europe/Paris',
      range: RANGE,
      includeDrafts: true,
    });
    expect(views.map((v) => [v.eventId, v.originalStart.toISOString()])).toEqual([
      ['evt', OCT5.toISOString()],
      ['evt', OCT12.toISOString()],
      ['tail', OCT19.toISOString()],
      ['tail', OCT26.toISOString()],
    ]);
  });

  it('what had been stored for a date follows it into the second row', () => {
    const cut = feedOf([head, weekly({ ...tail, occurrences: [own(OCT26, { title: 'Derby' })] })]);
    expect(entryOf(cut, UID('evt', OCT26))).toContain('SUMMARY:Derby');
    expect(uids(cut)).toHaveLength(4);
  });
});

describe('visibility of dates in the pages', () => {
  it('filters by the category and the member of each date, not only of the series', () => {
    const events = [
      weekly({
        occurrences: [own(OCT12, { categoryKey: 'soiree' })],
      }),
    ];
    const options = { timeZone: 'Europe/Paris', range: RANGE, includeDrafts: true };

    expect(expandEvents(events, { ...options, filters: { categoryKey: 'soiree' } })).toHaveLength(
      1,
    );
    expect(expandEvents(events, { ...options, filters: { categoryKey: 'sport' } })).toHaveLength(3);
  });

  it('finds a date moved into the window although the series says another day', () => {
    const moved = weekly({
      occurrences: [
        own(OCT12, {
          startsAt: new Date('2026-12-01T17:00:00Z'),
          endsAt: new Date('2026-12-01T19:00:00Z'),
        }),
      ],
    });
    const december = expandEvents([moved], {
      timeZone: 'Europe/Paris',
      range: { from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-02T00:00:00Z') },
      includeDrafts: true,
    });

    expect(december.map((v) => v.originalStart)).toEqual([OCT12]);
    // …and it is no longer on the day the series gave it.
    const october = expandEvents([moved], {
      timeZone: 'Europe/Paris',
      range: { from: new Date('2026-10-12T00:00:00Z'), to: new Date('2026-10-13T00:00:00Z') },
      includeDrafts: true,
    });
    expect(october).toEqual([]);
  });
});
