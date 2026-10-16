import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { createFakeEventsDb } from '@/test/fake-events-db';

vi.mock('@/config', () => ({ getConfig: () => ({ bde: { timezone: 'Europe/Paris' } }) }));

const { SeriesError, deleteFollowing, updateFollowing, updateOccurrence } =
  await import('./series-operations');

const db = createFakeEventsDb();
const tx = db.prisma as unknown as Prisma.TransactionClient;

/** Mondays at 18:00 in Paris: summer time until Oct 25 (16:00Z), then winter time (17:00Z). */
const MONDAYS = [
  '2026-10-05T16:00:00Z',
  '2026-10-12T16:00:00Z',
  '2026-10-19T16:00:00Z',
  '2026-10-26T17:00:00Z',
  '2026-11-02T17:00:00Z',
  '2026-11-09T17:00:00Z',
].map((iso) => new Date(iso));
const [OCT5, OCT12, OCT19, OCT26, NOV2, NOV9] = MONDAYS as [Date, Date, Date, Date, Date, Date];

const hours = (n: number) => n * 3_600_000;

function addSeries(overrides: Record<string, unknown> = {}) {
  const [row] = db.add('event', {
    id: 'evt',
    title: 'Training',
    description: 'Weekly training',
    location: 'Gym',
    categoryKey: 'sport',
    status: 'CONFIRMED',
    startsAt: OCT5,
    endsAt: new Date(OCT5.getTime() + hours(2)),
    repeat: { freq: 'WEEKLY', interval: 1 },
    recurrenceUntil: new Date('2026-11-09T22:00:00Z'),
    schoolYear: '2026-2027',
    authorLogin: 'alice',
    authorId: null,
    ...overrides,
  });
  return row!;
}

const run = <T>(work: (client: Prisma.TransactionClient) => Promise<T>) =>
  db.prisma.$transaction(async () => work(tx));

beforeEach(() => db.reset());

describe('updateOccurrence ("only this one")', () => {
  it('stores only what differs from the series, and nothing when it does not', async () => {
    addSeries();

    await run((t) => updateOccurrence(t, 'evt', OCT12, { values: { location: 'Pool' } }));
    expect(db.table('eventOccurrence')).toMatchObject([
      { eventId: 'evt', occurrenceStart: OCT12, location: 'Pool', title: null, status: null },
    ]);

    // The same value as the series': nothing of its own is left, so the row goes.
    await run((t) => updateOccurrence(t, 'evt', OCT12, { values: { location: 'Gym' } }));
    expect(db.table('eventOccurrence')).toEqual([]);
  });

  it('merges successive edits of the same date and leaves the series alone', async () => {
    addSeries();
    await run((t) => updateOccurrence(t, 'evt', OCT12, { values: { location: 'Pool' } }));
    await run((t) => updateOccurrence(t, 'evt', OCT12, { values: { title: 'Match' } }));

    expect(db.table('eventOccurrence')).toMatchObject([{ location: 'Pool', title: 'Match' }]);
    expect(db.event('evt')).toMatchObject({ title: 'Training', location: 'Gym' });
    expect(db.table('event')).toHaveLength(1);
  });

  it('moves a date by storing its new start and end, keyed by where the series puts it', async () => {
    addSeries();
    const start = new Date('2026-10-13T17:00:00Z');
    const end = new Date(start.getTime() + hours(1));
    const result = await run((t) => updateOccurrence(t, 'evt', OCT12, { values: { start, end } }));

    expect(result.changed).toEqual(['time']);
    expect(db.table('eventOccurrence')).toMatchObject([
      { occurrenceStart: OCT12, startsAt: start, endsAt: end },
    ]);
  });

  it('gives a date its own members in charge, possibly nobody, and takes them back', async () => {
    addSeries();
    db.add('user', { id: 'u1', login: 'bob', fullName: 'Bob' });
    db.add('eventAssignee', { eventId: 'evt', login: 'bob', userId: 'u1' });

    await run((t) =>
      updateOccurrence(t, 'evt', OCT12, { values: { assigneeLogins: [] }, assignees: [] }),
    );
    expect(db.table('eventOccurrence')).toMatchObject([{ assigneesOverridden: true }]);
    expect(db.table('eventOccurrenceAssignee')).toEqual([]);

    await run((t) =>
      updateOccurrence(t, 'evt', OCT12, {
        values: { assigneeLogins: ['bob'] },
        assignees: [{ id: 'u1', login: 'bob' }],
      }),
    );
    // Back to the series' list: the date follows it again, nothing of its own is left.
    expect(db.table('eventOccurrence')).toEqual([]);
    expect(db.table('eventOccurrenceAssignee')).toEqual([]);
  });

  it('keeps the row of a date whose confirmation was announced, so it is never announced twice', async () => {
    addSeries({ status: 'DRAFT' });
    await run((t) => updateOccurrence(t, 'evt', OCT12, { values: { status: 'CONFIRMED' } }));
    const claimed = new Date('2026-10-01T10:00:00Z');
    db.add('eventOccurrence', {
      ...db.table('eventOccurrence')[0]!,
      id: 'occ-claimed',
      occurrenceStart: OCT19,
      status: 'CONFIRMED',
      confirmationNotifiedAt: claimed,
    });

    // Back to the series' own status (draft): the row stays, because of the claim.
    await run((t) => updateOccurrence(t, 'evt', OCT19, { values: { status: 'DRAFT' } }));
    expect(db.table('eventOccurrence').find((o) => o.occurrenceStart === OCT19)).toMatchObject({
      status: null,
      confirmationNotifiedAt: claimed,
    });
  });

  it('refuses a date the series does not have, and an event that is gone', async () => {
    addSeries();
    await expect(
      run((t) =>
        updateOccurrence(t, 'evt', new Date('2026-10-13T16:00:00Z'), { values: { title: 'x' } }),
      ),
    ).rejects.toMatchObject({ code: 'occurrenceGone' });
    await expect(
      run((t) => updateOccurrence(t, 'nope', OCT12, { values: { title: 'x' } })),
    ).rejects.toBeInstanceOf(SeriesError);
  });
});

describe('updateFollowing ("this one and the following")', () => {
  it('on the first date changes the whole series without cutting it', async () => {
    addSeries();
    const result = await run((t) =>
      updateFollowing(t, 'evt', OCT5, { values: { location: 'Pool' } }),
    );

    expect(result).toMatchObject({ eventId: 'evt', split: false, changed: ['location'] });
    expect(db.table('event')).toHaveLength(1);
    expect(db.event('evt')).toMatchObject({ location: 'Pool', recurrenceUntil: expect.any(Date) });
  });

  it('cuts the series in two on another date: the first part stops before it', async () => {
    addSeries();
    db.add('user', { id: 'u1', login: 'bob', fullName: 'Bob' });
    db.add('eventAssignee', { eventId: 'evt', login: 'bob', userId: 'u1' });
    const result = await run((t) =>
      updateFollowing(t, 'evt', OCT19, { values: { location: 'Pool' } }),
    );

    expect(result.split).toBe(true);
    const [head, tail] = db.table('event');
    expect(head).toMatchObject({ id: 'evt', location: 'Gym', recurrenceUntil: OCT12 });
    expect(tail).toMatchObject({
      id: result.eventId,
      location: 'Pool',
      startsAt: OCT19,
      recurrenceUntil: new Date('2026-11-09T22:00:00Z'),
      seriesId: 'evt',
      authorLogin: 'alice',
      status: 'CONFIRMED',
    });
    expect(db.event(result.eventId)?.assignees).toMatchObject([{ login: 'bob' }]);
    // A cut changes nothing else: the first part keeps its dates, the second the rest.
    expect(result.occurrenceStart).toEqual(OCT19);
  });

  it('hands the second part what was stored about its dates, and keeps the first part its own', async () => {
    addSeries();
    db.add('eventCancellation', { eventId: 'evt', occurrenceStart: OCT12 });
    db.add('eventCancellation', { eventId: 'evt', occurrenceStart: NOV2 });
    db.add('eventReminder', { eventId: 'evt', occurrenceStart: OCT12 });
    db.add('eventReminder', { eventId: 'evt', occurrenceStart: OCT26 });
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT12, title: 'Early' });
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: NOV9, title: 'Late' });

    const { eventId } = await run((t) =>
      updateFollowing(t, 'evt', OCT19, { values: { location: 'Pool' } }),
    );

    const starts = (name: 'eventCancellation' | 'eventReminder' | 'eventOccurrence', id: string) =>
      db
        .table(name)
        .filter((row) => row.eventId === id)
        .map((row) => row.occurrenceStart);
    expect(starts('eventCancellation', 'evt')).toEqual([OCT12]);
    expect(starts('eventCancellation', eventId)).toEqual([NOV2]);
    expect(starts('eventReminder', 'evt')).toEqual([OCT12]);
    expect(starts('eventReminder', eventId)).toEqual([OCT26]);
    expect(starts('eventOccurrence', 'evt')).toEqual([OCT12]);
    expect(starts('eventOccurrence', eventId)).toEqual([NOV9]);
  });

  it('does not cut a series for a change that changes nothing', async () => {
    addSeries();
    const result = await run((t) =>
      updateFollowing(t, 'evt', OCT19, { values: { location: 'Gym' } }),
    );

    expect(result).toMatchObject({ split: false, changed: [], eventId: 'evt' });
    expect(db.table('event')).toHaveLength(1);
    expect(db.event('evt')?.recurrenceUntil).toEqual(new Date('2026-11-09T22:00:00Z'));
  });

  it('a series cut at its second date leaves an ordinary event behind', async () => {
    addSeries();
    await run((t) => updateFollowing(t, 'evt', OCT12, { values: { location: 'Pool' } }));

    expect(db.event('evt')).toMatchObject({ repeat: null, recurrenceUntil: null });
  });

  it('replaces what the change decides in the dates that had their own, and keeps the rest', async () => {
    addSeries();
    db.add('eventOccurrence', {
      eventId: 'evt',
      occurrenceStart: OCT26,
      location: 'Pool',
      title: 'Derby',
    });
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: NOV2, location: 'Track' });

    const result = await run((t) =>
      updateFollowing(t, 'evt', OCT19, { values: { location: 'Hall' } }),
    );

    // Both dates lose their own place; the second has nothing else of its own and goes, the first keeps its title.
    expect(result.aligned).toBe(2);
    expect(db.table('eventOccurrence')).toMatchObject([
      { eventId: result.eventId, occurrenceStart: OCT26, title: 'Derby', location: null },
    ]);
    expect(db.event(result.eventId)).toMatchObject({ location: 'Hall' });
  });

  it('confirming the following also confirms the dates that were draft, and drops their draft status', async () => {
    addSeries({ confirmationNotifiedAt: new Date('2026-09-01T00:00:00Z') });
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT26, status: 'DRAFT' });
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT12, status: 'DRAFT' });
    // The series is confirmed from the 19th: draft dates before it stay as they are.
    const result = await run((t) =>
      updateFollowing(t, 'evt', OCT19, { values: { status: 'DRAFT' } }),
    );
    expect(db.event(result.eventId)?.status).toBe('DRAFT');
    const confirm = await run((t) =>
      updateFollowing(t, result.eventId, OCT19, { values: { status: 'CONFIRMED' } }),
    );

    expect(confirm.changed).toEqual(['status']);
    expect(db.table('eventOccurrence').map((o) => [o.eventId, o.occurrenceStart])).toEqual([
      ['evt', OCT12],
    ]);
  });

  it('is announced once: the second part inherits the notice of the series', async () => {
    const claimed = new Date('2026-09-01T00:00:00Z');
    addSeries({ confirmationNotifiedAt: claimed });
    const { eventId } = await run((t) =>
      updateFollowing(t, 'evt', OCT19, { values: { status: 'DRAFT' } }),
    );

    expect(db.event(eventId)?.confirmationNotifiedAt).toEqual(claimed);
  });

  it('can change the frequency and the end of the following dates', async () => {
    addSeries();
    const result = await run((t) =>
      updateFollowing(t, 'evt', OCT19, {
        values: {},
        repeat: {
          rule: { freq: 'WEEKLY', interval: 2 },
          until: new Date('2026-11-30T22:00:00Z'),
        },
      }),
    );

    expect(result).toMatchObject({ split: true, ruleChanged: true });
    expect(db.event(result.eventId)).toMatchObject({
      repeat: { freq: 'WEEKLY', interval: 2 },
      recurrenceUntil: new Date('2026-11-30T22:00:00Z'),
    });
  });

  describe('with the clocks changing (Europe/Paris, winter time from Oct 25 2026)', () => {
    it('moving the hour keeps what was stored about each day and re-keys it to the new hour', async () => {
      addSeries();
      db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT26, title: 'Derby' });
      db.add('eventCancellation', { eventId: 'evt', occurrenceStart: NOV2 });
      db.add('eventReminder', { eventId: 'evt', occurrenceStart: OCT26 });

      // 18:00 → 20:00 from the 19th: 18:00Z on the 19th (summer), 19:00Z after the change of hour (winter).
      const start = new Date('2026-10-19T18:00:00Z');
      const result = await run((t) =>
        updateFollowing(t, 'evt', OCT19, {
          values: { start, end: new Date(start.getTime() + hours(2)) },
        }),
      );

      const newOct26 = new Date('2026-10-26T19:00:00Z');
      const newNov2 = new Date('2026-11-02T19:00:00Z');
      expect(result.dropped).toBe(0);
      expect(db.table('eventOccurrence')).toMatchObject([
        { eventId: result.eventId, occurrenceStart: newOct26, title: 'Derby' },
      ]);
      expect(db.table('eventCancellation')).toMatchObject([
        { eventId: result.eventId, occurrenceStart: newNov2 },
      ]);
      // A reminder already sent stays sent: once per date, whatever the date's hour became.
      expect(db.table('eventReminder')).toMatchObject([
        { eventId: result.eventId, occurrenceStart: newOct26 },
      ]);
    });

    it('moving the hour also takes the date that was moved on its own back to the series: the change decides', async () => {
      addSeries();
      db.add('eventOccurrence', {
        eventId: 'evt',
        occurrenceStart: OCT26,
        title: 'Derby',
        startsAt: new Date('2026-10-27T17:00:00Z'),
        endsAt: new Date('2026-10-27T19:00:00Z'),
      });

      const start = new Date('2026-10-19T18:00:00Z');
      await run((t) =>
        updateFollowing(t, 'evt', OCT19, {
          values: { start, end: new Date(start.getTime() + hours(2)) },
        }),
      );

      // It keeps its title, but is no longer moved: it follows the series' new hour like the others.
      expect(db.table('eventOccurrence')).toMatchObject([
        {
          occurrenceStart: new Date('2026-10-26T19:00:00Z'),
          title: 'Derby',
          startsAt: null,
          endsAt: null,
        },
      ]);
    });

    it('moving the day gives every date a new place: what was stored about the old ones is dropped', async () => {
      addSeries();
      db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT26, title: 'Derby' });
      db.add('eventCancellation', { eventId: 'evt', occurrenceStart: NOV2 });

      // Tuesdays instead of Mondays, from the 19th.
      const start = new Date('2026-10-20T16:00:00Z');
      const result = await run((t) =>
        updateFollowing(t, 'evt', OCT19, {
          values: { start, end: new Date(start.getTime() + hours(2)) },
        }),
      );

      expect(result.dropped).toBe(2);
      expect(db.table('eventOccurrence')).toEqual([]);
      expect(db.table('eventCancellation')).toEqual([]);
      expect(db.event(result.eventId)).toMatchObject({ startsAt: start });
    });
  });

  describe('a monthly series on the 31st', () => {
    const JAN31 = new Date('2027-01-31T17:00:00Z'); // 18:00 in Paris
    const monthly = () =>
      addSeries({
        repeat: { freq: 'MONTHLY', interval: 1 },
        startsAt: JAN31,
        endsAt: new Date(JAN31.getTime() + hours(2)),
        recurrenceUntil: new Date('2027-06-30T22:00:00Z'),
      });
    const FEB28 = new Date('2027-02-28T17:00:00Z');
    const MAR31 = new Date('2027-03-31T16:00:00Z'); // summer time since Mar 28

    it('keeps the 31st after a cut on a shorter month (the second part is anchored on the 31st)', async () => {
      monthly();
      const { eventId } = await run((t) =>
        updateFollowing(t, 'evt', FEB28, { values: { location: 'Pool' } }),
      );

      // the rule says the day it left out, which is no longer the one of the first date
      expect(db.event(eventId)).toMatchObject({
        startsAt: FEB28,
        repeat: { freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 31 } },
      });
      const { allOccurrences } = await import('./recurrence');
      const starts = allOccurrences(db.event(eventId) as never, 'Europe/Paris').map((o) =>
        o.start.toISOString(),
      );
      expect(starts.slice(0, 3)).toEqual([
        FEB28.toISOString(),
        MAR31.toISOString(),
        '2027-04-30T16:00:00.000Z',
      ]);
    });

    it('keeps the day when only the hour changes, and follows the first date when the form asks for a rule without one', async () => {
      monthly();
      const sameDay = new Date('2027-02-28T19:00:00Z');
      const { eventId } = await run((t) =>
        updateFollowing(t, 'evt', FEB28, {
          values: { start: sameDay, end: new Date(sameDay.getTime() + hours(1)) },
        }),
      );
      expect(db.event(eventId)).toMatchObject({
        repeat: { freq: 'MONTHLY', interval: 1, monthly: { kind: 'day', day: 31 } },
        startsAt: sameDay,
      });

      // "Every month" (no day written) from another day: it is on that day now
      const otherDay = new Date('2027-02-27T19:00:00Z');
      await run((t) =>
        updateFollowing(t, eventId, sameDay, {
          values: { start: otherDay, end: new Date(otherDay.getTime() + hours(1)) },
          repeat: {
            rule: { freq: 'MONTHLY', interval: 1 },
            until: new Date('2027-06-30T22:00:00Z'),
          },
        }),
      );
      expect(db.event(eventId)).toMatchObject({ startsAt: otherDay });
      expect(db.event(eventId)?.repeat).toEqual({ freq: 'MONTHLY', interval: 1 });
    });

    it('a leap year: the 29th of February, then the 31st again', async () => {
      const jan31 = new Date('2028-01-31T17:00:00Z');
      addSeries({
        repeat: { freq: 'MONTHLY', interval: 1 },
        startsAt: jan31,
        endsAt: new Date(jan31.getTime() + hours(2)),
        recurrenceUntil: new Date('2028-04-30T22:00:00Z'),
      });
      const feb29 = new Date('2028-02-29T17:00:00Z');
      const { eventId } = await run((t) =>
        updateFollowing(t, 'evt', feb29, { values: { location: 'Pool' } }),
      );
      const { allOccurrences } = await import('./recurrence');
      const starts = allOccurrences(db.event(eventId) as never, 'Europe/Paris').map((o) =>
        o.start.toISOString().slice(0, 10),
      );
      expect(starts).toEqual(['2028-02-29', '2028-03-31', '2028-04-30']);
    });
  });

  it('adds nothing when a change fails halfway: the whole cut is rolled back', async () => {
    addSeries();
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT26, title: 'Derby' });
    const before = JSON.stringify([db.table('event'), db.table('eventOccurrence')]);

    await expect(
      run(async (t) => {
        await updateFollowing(t, 'evt', OCT19, { values: { location: 'Pool' } });
        throw new Error('the audit entry could not be written');
      }),
    ).rejects.toThrow('audit entry');

    expect(JSON.stringify([db.table('event'), db.table('eventOccurrence')])).toBe(before);
  });
});

describe('deleteFollowing', () => {
  it('stops the series at the date before and forgets what was stored from this date on', async () => {
    addSeries();
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT12, title: 'Kept' });
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: NOV2, title: 'Gone' });
    db.add('eventCancellation', { eventId: 'evt', occurrenceStart: NOV9 });
    db.add('eventReminder', { eventId: 'evt', occurrenceStart: OCT26 });

    const result = await run((t) => deleteFollowing(t, 'evt', OCT19));

    expect(result).toEqual({ deletedEvent: false, removed: 4 });
    expect(db.event('evt')).toMatchObject({
      recurrenceUntil: OCT12,
      repeat: { freq: 'WEEKLY', interval: 1 },
    });
    expect(db.table('eventOccurrence')).toMatchObject([{ title: 'Kept' }]);
    expect(db.table('eventCancellation')).toEqual([]);
    expect(db.table('eventReminder')).toEqual([]);
  });

  it('on the first date deletes the event and everything that hangs from it', async () => {
    addSeries();
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT12, title: 'x' });
    db.add('eventCancellation', { eventId: 'evt', occurrenceStart: NOV9 });

    const result = await run((t) => deleteFollowing(t, 'evt', OCT5));

    expect(result).toEqual({ deletedEvent: true, removed: 6 });
    expect(db.table('event')).toEqual([]);
    expect(db.table('eventOccurrence')).toEqual([]);
    expect(db.table('eventCancellation')).toEqual([]);
  });

  it('from the second date leaves one date: an ordinary event', async () => {
    addSeries();
    await run((t) => deleteFollowing(t, 'evt', OCT12));
    expect(db.event('evt')).toMatchObject({ repeat: null, recurrenceUntil: null });
  });

  it('refuses a date that is not one of the series', async () => {
    addSeries();
    await expect(
      run((t) => deleteFollowing(t, 'evt', new Date('2026-10-13T16:00:00Z'))),
    ).rejects.toMatchObject({ code: 'occurrenceGone' });
  });
});
