import { describe, expect, it } from 'vitest';
import { expandEvents, type EventRecord } from './occurrences';

const PARIS = 'Europe/Paris';
const RANGE = { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') };

function record(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'evt1',
    title: 'Tournoi',
    description: null,
    location: null,
    categoryKey: 'sport',
    status: 'CONFIRMED',
    startsAt: new Date('2026-05-10T18:00:00Z'),
    endsAt: new Date('2026-05-10T20:00:00Z'),
    recurrence: 'NONE',
    recurrenceUntil: null,
    schoolYear: '2025-2026',
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    assignees: [],
    cancellations: [],
    ...overrides,
  };
}

const expand = (events: EventRecord[], includeDrafts: boolean, filters = {}) =>
  expandEvents(events, { timeZone: PARIS, range: RANGE, includeDrafts, filters });

describe('expandEvents — draft visibility', () => {
  const confirmed = record({ id: 'a', title: 'Confirmé' });
  const draft = record({ id: 'b', title: 'Brouillon', status: 'DRAFT' });

  it('hides drafts from users without the events permission', () => {
    expect(expand([confirmed, draft], false).map((o) => o.title)).toEqual(['Confirmé']);
  });

  it('shows drafts to users with the events permission', () => {
    expect(expand([confirmed, draft], true).map((o) => o.title)).toEqual(
      expect.arrayContaining(['Confirmé', 'Brouillon']),
    );
  });

  it('hides every occurrence of a draft series', () => {
    const draftSeries = record({
      status: 'DRAFT',
      recurrence: 'WEEKLY',
      recurrenceUntil: new Date('2026-05-31T00:00:00Z'),
    });
    expect(expand([draftSeries], false)).toEqual([]);
  });
});

describe('expandEvents — series and cancellations', () => {
  const series = record({
    recurrence: 'WEEKLY',
    recurrenceUntil: new Date('2026-05-31T00:00:00Z'),
  });

  it('expands a series into dated occurrences with distinct keys', () => {
    const result = expand([series], false);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((o) => o.key)).size).toBe(3);
    expect(result.every((o) => o.isRecurring)).toBe(true);
  });

  it('omits only the cancelled occurrence', () => {
    const withCancellation = {
      ...series,
      cancellations: [{ occurrenceStart: new Date('2026-05-17T18:00:00Z') }],
    };
    const starts = expand([withCancellation], false).map((o) => o.start.toISOString());
    expect(starts).toEqual(['2026-05-10T18:00:00.000Z', '2026-05-24T18:00:00.000Z']);
  });

  it('sorts occurrences of several events chronologically', () => {
    const later = record({
      id: 'late',
      title: 'Tard',
      startsAt: new Date('2026-05-20T10:00:00Z'),
      endsAt: new Date('2026-05-20T11:00:00Z'),
    });
    const earlier = record({
      id: 'early',
      title: 'Tôt',
      startsAt: new Date('2026-05-02T10:00:00Z'),
      endsAt: new Date('2026-05-02T11:00:00Z'),
    });
    expect(expand([later, earlier], false).map((o) => o.title)).toEqual(['Tôt', 'Tard']);
  });
});

describe('expandEvents — filters', () => {
  const sport = record({
    id: 's',
    assignees: [{ login: 'alice', user: { fullName: 'Alice A' } }],
  });
  const party = record({
    id: 'p',
    categoryKey: 'soiree',
    schoolYear: '2024-2025',
    assignees: [{ login: 'bob', user: null }],
  });

  it('filters by category', () => {
    expect(expand([sport, party], false, { categoryKey: 'soiree' }).map((o) => o.eventId)).toEqual([
      'p',
    ]);
  });

  it('filters by school year', () => {
    expect(
      expand([sport, party], false, { schoolYear: '2025-2026' }).map((o) => o.eventId),
    ).toEqual(['s']);
  });

  it('filters by member in charge', () => {
    expect(expand([sport, party], false, { assigneeLogin: 'bob' }).map((o) => o.eventId)).toEqual([
      'p',
    ]);
  });

  it('falls back to the login when the assignee account no longer exists', () => {
    const [view] = expand([party], false);
    expect(view?.assignees).toEqual([{ login: 'bob', name: 'bob' }]);
  });
});
