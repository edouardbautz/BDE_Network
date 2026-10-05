import { describe, expect, it } from 'vitest';
import { eventsLinkQuery, parseEventsQuery } from './search-params';

const options = {
  now: new Date('2026-10-15T10:00:00Z'),
  timeZone: 'Europe/Paris',
  categoryKeys: ['soiree', 'sport'],
  schoolYears: ['2025-2026', '2026-2027'],
  assigneeLogins: ['alice', 'bob'],
};

describe('parseEventsQuery', () => {
  it('uses sensible defaults for an empty query string', () => {
    expect(parseEventsQuery({}, options)).toEqual({
      view: undefined,
      month: { year: 2026, month: 10 },
      day: null,
      filters: { categoryKey: undefined, assigneeLogin: undefined, schoolYear: undefined },
    });
  });

  it('reads view, month, day and filters', () => {
    const query = parseEventsQuery(
      {
        view: 'list',
        month: '2026-12',
        day: '2026-12-05',
        category: 'sport',
        assignee: 'bob',
        schoolYear: '2026-2027',
      },
      options,
    );
    expect(query.view).toBe('list');
    expect(query.month).toEqual({ year: 2026, month: 12 });
    expect(query.day).toEqual({ year: 2026, month: 12, day: 5 });
    expect(query.filters).toEqual({
      categoryKey: 'sport',
      assigneeLogin: 'bob',
      schoolYear: '2026-2027',
    });
  });

  it('ignores malformed or unknown values instead of failing', () => {
    const query = parseEventsQuery(
      {
        view: 'grid',
        month: '2026-99',
        day: '2026-02-30',
        category: 'hack',
        assignee: "x' OR 1=1",
        schoolYear: '1999-2000',
      },
      options,
    );
    expect(query.view).toBeUndefined();
    expect(query.month).toEqual({ year: 2026, month: 10 });
    expect(query.day).toBeNull();
    expect(query.filters).toEqual({
      categoryKey: undefined,
      assigneeLogin: undefined,
      schoolYear: undefined,
    });
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parseEventsQuery({ category: ['sport', 'soiree'] }, options).filters.categoryKey).toBe(
      'sport',
    );
  });

  it('defaults to the current month in the BDE timezone', () => {
    const lateOnTheThirtieth = { ...options, now: new Date('2026-09-30T23:30:00Z') };
    expect(parseEventsQuery({}, lateOnTheThirtieth).month).toEqual({ year: 2026, month: 10 });
  });
});

describe('eventsLinkQuery', () => {
  it('keeps active filters and omits empty values', () => {
    const query = parseEventsQuery({ category: 'sport' }, options);
    expect(eventsLinkQuery(query, { view: 'calendar', month: { year: 2026, month: 11 } })).toEqual({
      view: 'calendar',
      month: '2026-11',
      category: 'sport',
    });
  });

  it('returns an empty object with no filters and no overrides', () => {
    expect(eventsLinkQuery(parseEventsQuery({}, options))).toEqual({});
  });
});
