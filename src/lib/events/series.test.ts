import { describe, expect, it } from 'vitest';
import {
  NO_OVERRIDE,
  applyToOverride,
  changedFields,
  clearOverride,
  fieldsOf,
  hasOwnValues,
  isEmptyOverride,
  remapByLocalDay,
  resolveOccurrences,
  scopeFacts,
  seriesFieldsFor,
  seriesKeyOf,
  type EventRecord,
  type OccurrenceFields,
  type OverrideRecord,
} from './series';

const PARIS = 'Europe/Paris';
const hours = (n: number) => n * 3_600_000;

/** Mondays at 18:00 in Paris: summer time until Oct 25 (16:00Z), then winter time (17:00Z). */
const OCT5 = new Date('2026-10-05T16:00:00Z');
const OCT12 = new Date('2026-10-12T16:00:00Z');
const OCT19 = new Date('2026-10-19T16:00:00Z');
const OCT26 = new Date('2026-10-26T17:00:00Z');

function series(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'evt',
    title: 'Training',
    description: 'Weekly training',
    location: 'Gym',
    categoryKey: 'sport',
    status: 'CONFIRMED',
    startsAt: OCT5,
    endsAt: new Date(OCT5.getTime() + hours(2)),
    repeat: { freq: 'WEEKLY', interval: 1 },
    recurrenceUntil: new Date('2026-10-31T22:00:00Z'),
    schoolYear: '2026-2027',
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    confirmationNotifiedAt: new Date('2026-09-01T00:00:00Z'),
    assignees: [{ login: 'alice', user: { fullName: 'Alice' } }],
    cancellations: [],
    occurrences: [],
    ...overrides,
  };
}

function own(occurrenceStart: Date, values: Partial<OverrideRecord> = {}): OverrideRecord {
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
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    assignees: [],
    ...values,
  };
}

describe('resolveOccurrences', () => {
  it('computes the dates of the series on the wall clock, with no values of their own', () => {
    const dates = resolveOccurrences(series(), PARIS);

    expect(dates.map((d) => d.originalStart)).toEqual([OCT5, OCT12, OCT19, OCT26]);
    expect(dates.every((d) => !d.cancelled && !d.edited && d.status === 'CONFIRMED')).toBe(true);
    expect(dates[0]).toMatchObject({ title: 'Training', location: 'Gym', start: OCT5 });
  });

  it("puts a date's own values on top of the series', and only those", () => {
    const dates = resolveOccurrences(
      series({ occurrences: [own(OCT12, { location: 'Pool', title: 'Derby' })] }),
      PARIS,
    );

    expect(dates[1]).toMatchObject({ title: 'Derby', location: 'Pool', edited: true });
    expect(dates[1]!.description).toBe('Weekly training');
    expect(dates[0]).toMatchObject({ title: 'Training', edited: false });
  });

  it('a moved date has its new time but keeps the key the series gave it', () => {
    const start = new Date('2026-10-13T17:00:00Z');
    const end = new Date('2026-10-13T18:00:00Z');
    const moved = resolveOccurrences(
      series({ occurrences: [own(OCT12, { startsAt: start, endsAt: end })] }),
      PARIS,
    )[1]!;

    expect(moved).toMatchObject({ originalStart: OCT12, start, end, edited: true });
  });

  it("a date's own list of members in charge replaces the series', even when it is empty", () => {
    const dates = resolveOccurrences(
      series({ occurrences: [own(OCT12, { assigneesOverridden: true, assignees: [] })] }),
      PARIS,
    );

    expect(dates[0]!.assignees.map((a) => a.login)).toEqual(['alice']);
    expect(dates[1]!.assignees).toEqual([]);
  });

  it('flags cancelled dates without removing them', () => {
    const dates = resolveOccurrences(
      series({ cancellations: [{ occurrenceStart: OCT19 }] }),
      PARIS,
    );
    expect(dates.map((d) => d.cancelled)).toEqual([false, false, true, false]);
  });

  it('decides the status date by date', () => {
    const confirmed = resolveOccurrences(
      series({ occurrences: [own(OCT12, { status: 'DRAFT' })] }),
      PARIS,
    );
    expect(confirmed.map((d) => d.status)).toEqual([
      'CONFIRMED',
      'DRAFT',
      'CONFIRMED',
      'CONFIRMED',
    ]);

    const draft = resolveOccurrences(
      series({ status: 'DRAFT', occurrences: [own(OCT12, { status: 'CONFIRMED' })] }),
      PARIS,
    );
    expect(draft.map((d) => d.status)).toEqual(['DRAFT', 'CONFIRMED', 'DRAFT', 'DRAFT']);
  });

  it('says when a date was announced: its own notice if it was confirmed alone, else the series', () => {
    const own12 = new Date('2026-10-01T00:00:00Z');
    const seriesNotice = new Date('2026-09-01T00:00:00Z');
    const alone = resolveOccurrences(
      series({
        status: 'DRAFT',
        confirmationNotifiedAt: null,
        occurrences: [own(OCT12, { status: 'CONFIRMED', confirmationNotifiedAt: own12 })],
      }),
      PARIS,
    );
    expect(alone.map((d) => d.announcedAt)).toEqual([null, own12, null, null]);

    const wholeSeries = resolveOccurrences(
      series({
        confirmationNotifiedAt: seriesNotice,
        occurrences: [own(OCT12, { status: 'DRAFT' })],
      }),
      PARIS,
    );
    expect(wholeSeries[1]!.announcedAt).toEqual(seriesNotice);
  });

  it("takes the later of the date's and the series' modification time", () => {
    const dates = resolveOccurrences(
      series({
        occurrences: [own(OCT12, { title: 'x', updatedAt: new Date('2026-10-01T00:00:00Z') })],
      }),
      PARIS,
    );
    expect(dates[1]!.updatedAt).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(dates[0]!.updatedAt).toEqual(new Date('2026-09-01T00:00:00Z'));
  });
});

describe('seriesKeyOf', () => {
  it('is the id of the first row of a series that was cut, and the id of a series that was not', () => {
    expect(seriesKeyOf({ id: 'tail', seriesId: 'head' })).toBe('head');
    expect(seriesKeyOf({ id: 'evt', seriesId: null })).toBe('evt');
    expect(seriesKeyOf({ id: 'evt' })).toBe('evt');
  });
});

describe('fields of a date', () => {
  it('compares a form with what the date is, field by field', () => {
    const current = fieldsOf(resolveOccurrences(series(), PARIS)[1]!);
    expect(changedFields(current, { ...current })).toEqual([]);
    expect(changedFields(current, { ...current, location: 'Pool', title: 'x' })).toEqual([
      'title',
      'location',
    ]);
  });

  it('treats the start and the end as one field, and the members in charge as a set', () => {
    const current = fieldsOf(resolveOccurrences(series(), PARIS)[1]!);
    expect(
      changedFields(current, { ...current, end: new Date(current.end.getTime() + hours(1)) }),
    ).toEqual(['time']);
    expect(changedFields(current, { ...current, assigneeLogins: ['bob', 'alice'] })).toEqual([
      'assignees',
    ]);
    expect(
      changedFields(
        { ...current, assigneeLogins: ['a', 'b'] },
        { ...current, assigneeLogins: ['b', 'a'] },
      ),
    ).toEqual([]);
  });
});

describe('applyToOverride', () => {
  const base = series();
  const seriesFields = seriesFieldsFor(base, OCT12);
  const submitted = (values: Partial<OccurrenceFields>): OccurrenceFields => ({
    ...seriesFields,
    ...values,
  });

  it('stores a field that differs from the series, and drops one that no longer does', () => {
    const set = applyToOverride(NO_OVERRIDE, seriesFields, submitted({ location: 'Pool' }), [
      'location',
    ]);
    expect(set.data).toMatchObject({ location: 'Pool', title: null });

    const reset = applyToOverride(set.data, seriesFields, submitted({ location: 'Gym' }), [
      'location',
    ]);
    expect(isEmptyOverride(reset.data)).toBe(true);
  });

  it('touches only the fields it is told to', () => {
    const current = { ...NO_OVERRIDE, title: 'Derby', location: 'Pool' };
    const { data } = applyToOverride(current, seriesFields, submitted({ location: 'Hall' }), [
      'location',
    ]);
    expect(data).toMatchObject({ title: 'Derby', location: 'Hall' });
  });

  it('stores a moved date as its start and end together', () => {
    const start = new Date('2026-10-13T17:00:00Z');
    const end = new Date('2026-10-13T18:00:00Z');
    const moved = applyToOverride(NO_OVERRIDE, seriesFields, submitted({ start, end }), ['time']);
    expect(moved.data).toMatchObject({ startsAt: start, endsAt: end });

    const back = applyToOverride(moved.data, seriesFields, submitted({}), ['time']);
    expect(back.data).toMatchObject({ startsAt: null, endsAt: null });
  });

  it('gives a date its own members in charge, or takes them back', () => {
    const own1 = applyToOverride(
      NO_OVERRIDE,
      seriesFields,
      submitted({ assigneeLogins: ['bob'] }),
      ['assignees'],
    );
    expect(own1).toMatchObject({ data: { assigneesOverridden: true }, assignees: ['bob'] });

    const same = applyToOverride(own1.data, seriesFields, submitted({}), ['assignees']);
    expect(same).toMatchObject({ data: { assigneesOverridden: false }, assignees: null });

    const untouched = applyToOverride(NO_OVERRIDE, seriesFields, submitted({}), ['title']);
    expect(untouched.assignees).toBeUndefined();
  });

  it("a status equal to the series' is not stored", () => {
    expect(
      applyToOverride(NO_OVERRIDE, seriesFields, submitted({ status: 'CONFIRMED' }), ['status'])
        .data.status,
    ).toBeNull();
    expect(
      applyToOverride(NO_OVERRIDE, seriesFields, submitted({ status: 'DRAFT' }), ['status']).data
        .status,
    ).toBe('DRAFT');
  });
});

describe('clearOverride', () => {
  const full = {
    ...NO_OVERRIDE,
    title: 'Derby',
    location: 'Pool',
    status: 'DRAFT' as const,
    startsAt: OCT12,
    endsAt: OCT12,
    assigneesOverridden: true,
  };

  it('forgets the fields an edit has just decided for everyone, and keeps the others', () => {
    const { data } = clearOverride(full, ['location', 'status']);
    expect(data).toMatchObject({
      title: 'Derby',
      location: null,
      status: null,
      assigneesOverridden: true,
    });
  });

  it("forgets a moved date as a whole, and the date's own list of members", () => {
    const { data, assigneesCleared } = clearOverride(full, ['time', 'assignees']);
    expect(data).toMatchObject({ startsAt: null, endsAt: null, assigneesOverridden: false });
    expect(assigneesCleared).toBe(true);
    expect(clearOverride(NO_OVERRIDE, ['assignees']).assigneesCleared).toBe(false);
  });

  it('leaves an empty override when everything it had was decided', () => {
    expect(
      isEmptyOverride(
        clearOverride(full, ['title', 'location', 'status', 'time', 'assignees']).data,
      ),
    ).toBe(true);
  });
});

describe('hasOwnValues', () => {
  it('is false for no row, and for a row that only carries a notice', () => {
    expect(hasOwnValues(undefined)).toBe(false);
    expect(hasOwnValues(own(OCT12, { confirmationNotifiedAt: new Date() }))).toBe(false);
    expect(hasOwnValues(own(OCT12, { location: 'Pool' }))).toBe(true);
  });
});

describe('remapByLocalDay (Europe/Paris, the clocks change on Oct 25 2026)', () => {
  it('keeps a date that only changed hour, across the change of hour', () => {
    const oldStarts = [OCT19, OCT26];
    // 20:00 instead of 18:00: 18:00Z in summer time, 19:00Z in winter time.
    const newStarts = [new Date('2026-10-19T18:00:00Z'), new Date('2026-10-26T19:00:00Z')];
    const map = remapByLocalDay(oldStarts, newStarts, PARIS);

    expect(map.get(OCT19.getTime())).toEqual(newStarts[0]);
    expect(map.get(OCT26.getTime())).toEqual(newStarts[1]);
  });

  it('drops the dates whose day is not a date of the new series', () => {
    const tuesdays = [new Date('2026-10-20T16:00:00Z'), new Date('2026-10-27T17:00:00Z')];
    expect(remapByLocalDay([OCT19, OCT26], tuesdays, PARIS).size).toBe(0);
  });

  it('a date near midnight keeps its local day, not its UTC day', () => {
    // 00:30 Paris on the 12th is 22:30Z on the 11th.
    const old = new Date('2026-10-11T22:30:00Z');
    const moved = new Date('2026-10-11T21:30:00Z'); // 23:30 Paris on the 11th... the 11th, not the 12th
    expect(remapByLocalDay([old], [moved], PARIS).size).toBe(0);
    expect(remapByLocalDay([old], [new Date('2026-10-11T23:00:00Z')], PARIS).size).toBe(1);
  });
});

describe('scopeFacts', () => {
  const dates = resolveOccurrences(
    series({
      occurrences: [own(OCT19, { location: 'Pool' }), own(OCT26, { status: 'DRAFT' })],
      cancellations: [{ occurrenceStart: OCT12 }],
    }),
    PARIS,
  );

  it('counts what "and the following" is from a date', () => {
    expect(scopeFacts(dates, OCT12)).toEqual({
      isFirst: false,
      total: 4,
      following: 2,
      drafts: 1,
      edited: 2,
    });
  });

  it('on the first date it is the whole series', () => {
    expect(scopeFacts(dates, OCT5)).toMatchObject({ isFirst: true, following: 3 });
  });

  it('on the last date there is nothing after it', () => {
    expect(scopeFacts(dates, OCT26)).toMatchObject({
      isFirst: false,
      following: 0,
      drafts: 0,
      edited: 0,
    });
  });
});
