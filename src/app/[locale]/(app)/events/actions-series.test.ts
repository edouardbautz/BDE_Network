import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, memberWith } from '@/test/session-fixtures';

/**
 * The actions on an event and on the dates of a series, run end to end on an in-memory database
 * (src/test/fake-events-db.ts): the real operations, the real audit entries, the real transactions (rolled back on
 * failure, retried on a serialization failure). Only the session, the redirects and the notifications are doubles.
 * Who may act at all is checked in actions.test.ts.
 */

const { RedirectSignal, afterCallbacks } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  }
  return { RedirectSignal, afterCallbacks: [] as (() => unknown)[] };
});

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback);
  }),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({
    href,
    locale,
  }: {
    href: string | { pathname: string; query?: Record<string, string | number> };
    locale: string;
  }) =>
    typeof href === 'string'
      ? `/${locale}${href}`
      : `/${locale}${href.pathname}${
          href.query
            ? `?${new URLSearchParams(Object.entries(href.query).map(([k, v]) => [k, String(v)]))}`
            : ''
        }`,
  redirect: vi.fn(
    (options: { href: string | { pathname: string; query: Record<string, string | number> } }) => {
      throw new RedirectSignal(
        typeof options.href === 'string'
          ? options.href
          : `${options.href.pathname}?${new URLSearchParams(
              Object.entries(options.href.query).map(([k, v]) => [k, String(v)]),
            )}`,
      );
    },
  ),
}));
vi.mock('@/lib/events/notifications', () => ({
  notifyEventApproved: vi.fn(),
  notifyEventConfirmed: vi.fn(),
  notifyEventProposed: vi.fn(),
  notifyEventRefused: vi.fn(),
  notifyOccurrenceConfirmed: vi.fn(),
}));
vi.mock('@/lib/prisma', async () => {
  const { createFakeEventsDb } = await import('@/test/fake-events-db');
  const db = createFakeEventsDb();
  return { prisma: db.prisma, db };
});

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const {
  notifyEventApproved,
  notifyEventConfirmed,
  notifyEventProposed,
  notifyEventRefused,
  notifyOccurrenceConfirmed,
} = await import('@/lib/events/notifications');
const { db } = (await import('@/lib/prisma')) as unknown as {
  db: import('@/test/fake-events-db').FakeEventsDb;
};
const { deleteFollowingDates, refuseEvent, setEventStatus, updateEvent } =
  await import('./actions');

/** Mondays at 18:00 in Paris: summer time until Oct 25 (16:00Z), then winter time (17:00Z). */
const OCT5 = new Date('2026-10-05T16:00:00Z');
const OCT12 = new Date('2026-10-12T16:00:00Z');
const OCT19 = new Date('2026-10-19T16:00:00Z');
const OCT26 = new Date('2026-10-26T17:00:00Z');
const NOV2 = new Date('2026-11-02T17:00:00Z');

function addEvent(overrides: Record<string, unknown> = {}) {
  db.add('event', {
    id: 'evt',
    title: 'Training',
    description: 'Weekly training',
    location: 'Gym',
    categoryKey: 'sport',
    status: 'CONFIRMED',
    startsAt: OCT5,
    endsAt: new Date(OCT5.getTime() + 2 * 3_600_000),
    recurrence: 'WEEKLY',
    recurrenceUntil: new Date('2026-11-09T22:00:00Z'),
    schoolYear: '2026-2027',
    authorLogin: 'alice',
    confirmationNotifiedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  });
}

/** The edit form of the date it was opened from: what the page prefilled, with `values` changed. */
function form(values: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  const defaults: Record<string, string | string[]> = {
    title: 'Training',
    description: 'Weekly training',
    location: 'Gym',
    categoryKey: 'sport',
    startsAt: '2026-10-05T18:00',
    endsAt: '2026-10-05T20:00',
    recurrence: 'WEEKLY',
    recurrenceUntil: '2026-11-09',
    status: 'CONFIRMED',
    assignees: [],
  };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

/** The form of the date at `day` (a Monday, 18:00–20:00 Paris). */
const formAt = (day: string, values: Record<string, string | string[]> = {}) =>
  form({ startsAt: `${day}T18:00`, endsAt: `${day}T20:00`, ...values });

const withScope = (data: FormData, scope: string, occurrence: Date): FormData => {
  data.set('scope', scope);
  data.set('occurrence', String(occurrence.getTime()));
  return data;
};

async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.href;
    throw error;
  }
  throw new Error('expected a redirect');
}

async function runAfterCallbacks() {
  for (const callback of afterCallbacks.splice(0)) await callback();
}

const audit = () =>
  db.table('auditLog').map((entry) => ({ action: entry.action, ...(entry.metadata as object) }));

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  afterCallbacks.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(getConfig).mockReturnValue({
    bde: { timezone: 'Europe/Paris' },
    modules: { enabled: ['events'] },
    events: {
      categories: [
        { key: 'soiree', label: 'Soirée', color: '#db2777' },
        { key: 'sport', label: 'Sport', color: '#16a34a' },
      ],
      reminderHour: 18,
    },
  } as unknown as ReturnType<typeof getConfig>);
  vi.mocked(getEffectiveSession).mockResolvedValue(
    effective(memberWith(['events.view', 'events.validate'], 'real-actor')),
  );
  db.add('user', { id: 'u-bob', login: 'bob', fullName: 'Bob', status: 'MEMBER' });
});

describe('editing an event that does not repeat', () => {
  beforeEach(() => {
    addEvent({
      recurrence: 'NONE',
      recurrenceUntil: null,
      status: 'DRAFT',
      confirmationNotifiedAt: null,
    });
  });
  const plain = (values: Record<string, string | string[]> = {}) =>
    form({ recurrence: 'NONE', recurrenceUntil: '', status: 'DRAFT', ...values });

  it('saves the change and audits what changed, with no scope (there is only one date)', async () => {
    const href = await redirectOf(updateEvent('evt', {}, plain({ title: 'Nouveau titre' })));

    expect(href).toBe('/events/evt');
    expect(db.event('evt')).toMatchObject({ title: 'Nouveau titre' });
    expect(audit()).toEqual([{ action: 'event.update', changed: ['title'] }]);
    expect(db.table('event')).toHaveLength(1);
  });

  it('confirms through the form: audits the status and announces the event after the response', async () => {
    await redirectOf(updateEvent('evt', {}, plain({ status: 'CONFIRMED' })));

    expect(audit()).toEqual([{ action: 'event.status_change', from: 'DRAFT', to: 'CONFIRMED' }]);
    expect(notifyEventConfirmed).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(notifyEventConfirmed).toHaveBeenCalledWith('evt');
    expect(notifyOccurrenceConfirmed).not.toHaveBeenCalled();
  });

  it('does not announce an edit of an event that is already confirmed', async () => {
    db.reset();
    addEvent({ recurrence: 'NONE', recurrenceUntil: null });
    await redirectOf(updateEvent('evt', {}, plain({ status: 'CONFIRMED', title: 'Autre' })));
    expect(afterCallbacks).toHaveLength(0);
  });

  it('turns it into a series when a frequency is chosen', async () => {
    await redirectOf(
      updateEvent('evt', {}, plain({ recurrence: 'WEEKLY', recurrenceUntil: '2026-11-09' })),
    );
    expect(db.event('evt')).toMatchObject({ recurrence: 'WEEKLY' });
    expect(audit()).toEqual([{ action: 'event.update', changed: ['recurrence'] }]);
  });

  it('reports a missing event, a bad form and an unknown member in charge without writing', async () => {
    expect((await updateEvent('nope', {}, plain())).formError).toBe('notFound');
    expect((await updateEvent('evt', {}, plain({ title: '' }))).errors).toEqual({
      title: 'required',
    });
    expect((await updateEvent('evt', {}, plain({ assignees: ['ghost'] }))).formError).toBe(
      'invalidAssignee',
    );
    expect(audit()).toEqual([]);
  });

  it('events saved before location and description became mandatory need both on their next edit', async () => {
    db.reset();
    addEvent({ recurrence: 'NONE', recurrenceUntil: null, description: null, location: null });
    const state = await updateEvent('evt', {}, plain({ description: '', location: '' }));
    expect(state.errors).toEqual({ description: 'required', location: 'required' });

    await redirectOf(updateEvent('evt', {}, plain({ description: 'Enfin décrit', location: 'C' })));
    expect(db.event('evt')).toMatchObject({ description: 'Enfin décrit', location: 'C' });
  });
});

describe('editing one date of a series ("only this one")', () => {
  beforeEach(() => addEvent());

  it('gives the date its own values, leaves the series alone and says so in the audit log', async () => {
    const data = withScope(formAt('2026-10-12', { location: 'Pool' }), 'occurrence', OCT12);
    const href = await redirectOf(updateEvent('evt', {}, data));

    expect(href).toBe(`/events/evt?occ=${OCT12.getTime()}`);
    expect(db.table('event')).toHaveLength(1);
    expect(db.event('evt')).toMatchObject({ location: 'Gym' });
    expect(db.table('eventOccurrence')).toMatchObject([
      { eventId: 'evt', occurrenceStart: OCT12, location: 'Pool' },
    ]);
    expect(audit()).toEqual([
      {
        action: 'event.update',
        scope: 'occurrence',
        occurrenceStart: OCT12.toISOString(),
        changed: ['location'],
      },
    ]);
  });

  it("ignores the form's frequency and end date: one date has none of its own", async () => {
    const data = withScope(
      formAt('2026-10-12', {
        recurrence: 'BIWEEKLY',
        recurrenceUntil: '2026-12-01',
        title: 'Match',
      }),
      'occurrence',
      OCT12,
    );
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.event('evt')).toMatchObject({
      recurrence: 'WEEKLY',
      recurrenceUntil: new Date('2026-11-09T22:00:00Z'),
    });
    expect(db.table('eventOccurrence')).toMatchObject([{ title: 'Match' }]);
  });

  it('moves a date to another hour', async () => {
    const data = withScope(
      formAt('2026-10-12', { startsAt: '2026-10-12T19:00', endsAt: '2026-10-12T21:00' }),
      'occurrence',
      OCT12,
    );
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.table('eventOccurrence')).toMatchObject([
      {
        occurrenceStart: OCT12,
        startsAt: new Date('2026-10-12T17:00:00Z'),
        endsAt: new Date('2026-10-12T19:00:00Z'),
      },
    ]);
    expect(audit()[0]).toMatchObject({ changed: ['time'] });
  });

  it('saves nothing and audits nothing when nothing changed', async () => {
    await redirectOf(updateEvent('evt', {}, withScope(formAt('2026-10-12'), 'occurrence', OCT12)));
    expect(db.table('eventOccurrence')).toEqual([]);
    expect(audit()).toEqual([]);
  });

  it('puts the members in charge of that date alone', async () => {
    const data = withScope(formAt('2026-10-12', { assignees: ['bob'] }), 'occurrence', OCT12);
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.table('eventOccurrenceAssignee')).toMatchObject([{ login: 'bob', userId: 'u-bob' }]);
    expect(db.event('evt')?.assignees).toEqual([]);
  });

  it('announces a date confirmed on its own, alone, and never the series', async () => {
    db.reset();
    addEvent({ status: 'DRAFT', confirmationNotifiedAt: null });
    const data = withScope(formAt('2026-10-12', { status: 'CONFIRMED' }), 'occurrence', OCT12);
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.table('eventOccurrence')).toMatchObject([
      { occurrenceStart: OCT12, status: 'CONFIRMED' },
    ]);
    expect(audit()).toEqual([
      {
        action: 'event.status_change',
        scope: 'occurrence',
        occurrenceStart: OCT12.toISOString(),
        from: 'DRAFT',
        to: 'CONFIRMED',
      },
    ]);
    await runAfterCallbacks();
    expect(notifyOccurrenceConfirmed).toHaveBeenCalledTimes(1);
    expect(notifyOccurrenceConfirmed).toHaveBeenCalledWith('evt', OCT12);
    expect(notifyEventConfirmed).not.toHaveBeenCalled();
  });

  it('confirming through the form a date that went back to draft is not announced again', async () => {
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT12, status: 'DRAFT' });
    const data = withScope(formAt('2026-10-12', { status: 'CONFIRMED' }), 'occurrence', OCT12);
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.table('eventOccurrence')).toEqual([]);
    expect(audit()).toMatchObject([
      { action: 'event.status_change', from: 'DRAFT', to: 'CONFIRMED' },
    ]);
    await runAfterCallbacks();
    expect(notifyOccurrenceConfirmed).not.toHaveBeenCalled();
    expect(notifyEventConfirmed).not.toHaveBeenCalled();
  });

  it('refuses a scope it does not know, a date the series does not have, and writes nothing', async () => {
    await expect(
      updateEvent('evt', {}, withScope(formAt('2026-10-12'), 'everything', OCT12)),
    ).rejects.toThrow('Invalid scope');
    await expect(updateEvent('evt', {}, formAt('2026-10-12'))).rejects.toThrow('Invalid scope');

    const gone = withScope(
      formAt('2026-10-12', { title: 'x' }),
      'occurrence',
      new Date(OCT12.getTime() + 60_000),
    );
    expect(await redirectOf(updateEvent('evt', {}, gone))).toBe(
      '/events/evt?notice=occurrenceGone',
    );
    expect(db.table('eventOccurrence')).toEqual([]);
    expect(audit()).toEqual([]);
  });
});

describe('editing a date and the following', () => {
  beforeEach(() => addEvent());

  it('cuts the series on a date that is not the first, and says so in the audit log', async () => {
    const data = withScope(formAt('2026-10-19', { location: 'Pool' }), 'following', OCT19);
    const href = await redirectOf(updateEvent('evt', {}, data));

    const [head, tail] = db.table('event');
    expect(head).toMatchObject({ id: 'evt', location: 'Gym', recurrenceUntil: OCT12 });
    expect(tail).toMatchObject({ location: 'Pool', startsAt: OCT19, seriesId: 'evt' });
    // The page shown afterwards is the date, in the row that holds it now.
    expect(href).toBe(`/events/${tail!.id}?occ=${OCT19.getTime()}`);
    expect(audit()).toEqual([
      {
        action: 'event.update',
        scope: 'following',
        occurrenceStart: OCT19.toISOString(),
        changed: ['location'],
        splitInto: tail!.id,
      },
    ]);
  });

  it('on the first date changes the whole series: no cut, and the audit log says so', async () => {
    const data = withScope(formAt('2026-10-05', { location: 'Pool' }), 'following', OCT5);
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.table('event')).toHaveLength(1);
    expect(db.event('evt')).toMatchObject({ location: 'Pool' });
    expect(audit()).toEqual([
      {
        action: 'event.update',
        scope: 'following',
        occurrenceStart: OCT5.toISOString(),
        fromFirst: true,
        changed: ['location'],
      },
    ]);
  });

  it('changes the frequency and the end of the following dates', async () => {
    const data = withScope(
      formAt('2026-10-19', { recurrence: 'BIWEEKLY', recurrenceUntil: '2026-12-20' }),
      'following',
      OCT19,
    );
    await redirectOf(updateEvent('evt', {}, data));

    const [head, tail] = db.table('event');
    expect(head).toMatchObject({ recurrence: 'WEEKLY', recurrenceUntil: OCT12 });
    expect(tail).toMatchObject({
      recurrence: 'BIWEEKLY',
      recurrenceUntil: new Date('2026-12-20T22:59:00Z'),
    });
    expect(audit()[0]).toMatchObject({ changed: ['recurrence'] });
  });

  it('counts the dates edited on their own that the change aligned', async () => {
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT26, location: 'Pool' });
    const data = withScope(formAt('2026-10-19', { location: 'Hall' }), 'following', OCT19);
    await redirectOf(updateEvent('evt', {}, data));

    expect(audit()[0]).toMatchObject({ alignedDates: 1 });
    expect(db.table('eventOccurrence')).toEqual([]);
  });

  it('announces a confirmed following once, as one message about the new row, not once per date', async () => {
    db.reset();
    addEvent({ status: 'DRAFT', confirmationNotifiedAt: null });
    const data = withScope(formAt('2026-10-19', { status: 'CONFIRMED' }), 'following', OCT19);
    await redirectOf(updateEvent('evt', {}, data));
    await runAfterCallbacks();

    const tail = db.table('event')[1]!;
    expect(notifyEventConfirmed).toHaveBeenCalledTimes(1);
    expect(notifyEventConfirmed).toHaveBeenCalledWith(tail.id);
    expect(notifyOccurrenceConfirmed).not.toHaveBeenCalled();
  });

  it('does not cut the series when nothing changes', async () => {
    await redirectOf(updateEvent('evt', {}, withScope(formAt('2026-10-19'), 'following', OCT19)));
    expect(db.table('event')).toHaveLength(1);
    expect(audit()).toEqual([]);
  });

  it('leaves everything as it was when somebody else keeps changing the series (retried, then told)', async () => {
    db.failNextTransactions(3);
    const data = withScope(formAt('2026-10-19', { location: 'Pool' }), 'following', OCT19);

    expect(await redirectOf(updateEvent('evt', {}, data))).toBe('/events/evt?notice=seriesBusy');
    expect(db.transactionRuns).toBe(3);
    expect(db.table('event')).toHaveLength(1);
    expect(audit()).toEqual([]);
  });

  it('succeeds when a retry gets through', async () => {
    db.failNextTransactions(1);
    const data = withScope(formAt('2026-10-19', { location: 'Pool' }), 'following', OCT19);
    await redirectOf(updateEvent('evt', {}, data));

    expect(db.transactionRuns).toBe(2);
    expect(db.table('event')).toHaveLength(2);
    expect(audit()).toHaveLength(1);
  });
});

describe('confirming and putting back to draft', () => {
  describe('on a draft series', () => {
    beforeEach(() => addEvent({ status: 'DRAFT', confirmationNotifiedAt: null }));

    it('only this one: the date is confirmed and announced on its own', async () => {
      await setEventStatus('evt', 'CONFIRMED', OCT12.getTime(), 'occurrence');

      expect(db.table('eventOccurrence')).toMatchObject([
        { occurrenceStart: OCT12, status: 'CONFIRMED' },
      ]);
      expect(db.event('evt')?.status).toBe('DRAFT');
      await runAfterCallbacks();
      expect(notifyOccurrenceConfirmed).toHaveBeenCalledWith('evt', OCT12);
      expect(notifyEventConfirmed).not.toHaveBeenCalled();
    });

    it('this one and the following: one announcement for the whole confirmed part', async () => {
      db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: OCT26, status: 'DRAFT' });
      const { href } = await setEventStatus('evt', 'CONFIRMED', OCT19.getTime(), 'following');

      const tail = db.table('event')[1]!;
      expect(href).toBe(`/fr/events/${tail.id}?occ=${OCT19.getTime()}`);
      expect(tail).toMatchObject({ status: 'CONFIRMED', startsAt: OCT19 });
      expect(db.table('event')[0]).toMatchObject({ status: 'DRAFT', recurrenceUntil: OCT12 });
      await runAfterCallbacks();
      expect(notifyEventConfirmed).toHaveBeenCalledTimes(1);
      expect(notifyEventConfirmed).toHaveBeenCalledWith(tail.id);
      expect(audit()).toEqual([
        {
          action: 'event.status_change',
          scope: 'following',
          occurrenceStart: OCT19.toISOString(),
          from: 'DRAFT',
          to: 'CONFIRMED',
          splitInto: tail.id,
          alignedDates: 1,
        },
      ]);
    });

    it('from the first date it confirms the whole series, like the confirm button of an ordinary event', async () => {
      await setEventStatus('evt', 'CONFIRMED', OCT5.getTime(), 'following');

      expect(db.table('event')).toHaveLength(1);
      expect(db.event('evt')?.status).toBe('CONFIRMED');
      expect(audit()[0]).toMatchObject({ scope: 'following', fromFirst: true });
      await runAfterCallbacks();
      expect(notifyEventConfirmed).toHaveBeenCalledWith('evt');
    });
  });

  describe('on a confirmed series', () => {
    beforeEach(() => addEvent());

    it('only this one: the date goes back to draft, nobody is told', async () => {
      await setEventStatus('evt', 'DRAFT', OCT12.getTime(), 'occurrence');

      expect(db.table('eventOccurrence')).toMatchObject([
        { occurrenceStart: OCT12, status: 'DRAFT' },
      ]);
      expect(afterCallbacks).toHaveLength(0);
      expect(audit()[0]).toMatchObject({ scope: 'occurrence', from: 'CONFIRMED', to: 'DRAFT' });
    });

    it('confirming that date again removes what it had of its own and does not announce it again', async () => {
      await setEventStatus('evt', 'DRAFT', OCT12.getTime(), 'occurrence');
      await setEventStatus('evt', 'CONFIRMED', OCT12.getTime(), 'occurrence');

      expect(db.table('eventOccurrence')).toEqual([]);
      await runAfterCallbacks();
      expect(notifyOccurrenceConfirmed).not.toHaveBeenCalled();
    });

    it('this one and the following go back to draft in a row of their own', async () => {
      const target = await setEventStatus('evt', 'DRAFT', OCT19.getTime(), 'following');
      // The date and the following live under the address of the new row: the person is sent there.
      expect(target.href).toBe(`/fr/events/${db.table('event')[1]!.id}?occ=${OCT19.getTime()}`);
      expect(db.table('event').map((e) => [e.status, e.startsAt])).toEqual([
        ['CONFIRMED', OCT5],
        ['DRAFT', OCT19],
      ]);
      expect(afterCallbacks).toHaveLength(0);
    });

    it('does nothing, and says nothing, when the date already has that status', async () => {
      await setEventStatus('evt', 'CONFIRMED', OCT12.getTime(), 'occurrence');
      await setEventStatus('evt', 'CONFIRMED', OCT12.getTime(), 'following');
      expect(db.table('event')).toHaveLength(1);
      expect(audit()).toEqual([]);
      expect(afterCallbacks).toHaveLength(0);
    });

    it('needs a scope for a series, and rejects one it does not know', async () => {
      await expect(setEventStatus('evt', 'DRAFT', OCT12.getTime())).rejects.toThrow(
        'Invalid scope',
      );
      await expect(setEventStatus('evt', 'DRAFT', OCT12.getTime(), 'all')).rejects.toThrow(
        'Invalid scope',
      );
      expect(db.table('event')[0]?.status).toBe('CONFIRMED');
    });
  });

  it('an event that does not repeat needs no scope', async () => {
    addEvent({
      recurrence: 'NONE',
      recurrenceUntil: null,
      status: 'DRAFT',
      confirmationNotifiedAt: null,
    });
    await setEventStatus('evt', 'CONFIRMED');

    expect(db.event('evt')?.status).toBe('CONFIRMED');
    expect(audit()).toEqual([{ action: 'event.status_change', from: 'DRAFT', to: 'CONFIRMED' }]);
    await runAfterCallbacks();
    expect(notifyEventConfirmed).toHaveBeenCalledWith('evt');
  });
});

describe('deleting a date and the following', () => {
  beforeEach(() => addEvent());

  it('stops the series at the date before, and the audit log says how many dates went', async () => {
    db.add('eventOccurrence', { eventId: 'evt', occurrenceStart: NOV2, title: 'Gone' });
    const { href } = await deleteFollowingDates('evt', OCT19.getTime());

    expect(href).toBe('/fr/events/evt');
    expect(db.event('evt')).toMatchObject({ recurrenceUntil: OCT12 });
    expect(db.table('eventOccurrence')).toEqual([]);
    expect(audit()).toEqual([
      {
        action: 'event.delete',
        status: 'CONFIRMED',
        scope: 'following',
        occurrenceStart: OCT19.toISOString(),
        removedDates: 4,
      },
    ]);
  });

  it('from the first date deletes the event', async () => {
    const { href } = await deleteFollowingDates('evt', OCT5.getTime());

    expect(href).toBe('/fr/events');
    expect(db.table('event')).toEqual([]);
    expect(audit()[0]).toMatchObject({ scope: 'following', fromFirst: true, removedDates: 6 });
  });

  it('tells the person when the date or the event is already gone, and writes nothing', async () => {
    expect(await deleteFollowingDates('evt', OCT12.getTime() + 60_000)).toEqual({
      href: '/fr/events/evt?notice=occurrenceGone',
    });
    expect(await deleteFollowingDates('nope', OCT12.getTime())).toEqual({
      href: '/fr/events?notice=eventGone',
    });
    expect(db.table('event')).toHaveLength(1);
    expect(audit()).toEqual([]);
  });
});

// ---- the proposal circuit ---------------------------------------------------------------------------------------

describe('the proposal circuit', () => {
  /** Who acts: somebody who only proposes (the author of the events by default), or a validator. */
  const asProposer = (login = 'alice') =>
    vi
      .mocked(getEffectiveSession)
      .mockResolvedValue(effective(memberWith(['events.view', 'events.propose'], login)));
  const asValidator = () =>
    vi
      .mocked(getEffectiveSession)
      .mockResolvedValue(effective(memberWith(['events.view', 'events.validate'], 'real-actor')));

  /** An event that does not repeat, in the state given. */
  const addOneOff = (overrides: Record<string, unknown> = {}) =>
    addEvent({
      recurrence: 'NONE',
      recurrenceUntil: null,
      status: 'DRAFT',
      confirmationNotifiedAt: null,
      ...overrides,
    });
  const oneOff = (values: Record<string, string | string[]> = {}) =>
    form({ recurrence: 'NONE', recurrenceUntil: '', status: 'DRAFT', ...values });

  const REFUSED = {
    refusalComment: 'Pas ce jour-là',
    refusedByLogin: 'bob',
    refusedAt: new Date('2026-09-20T10:00:00Z'),
  };

  describe('a proposer', () => {
    beforeEach(() => asProposer());

    it('edits their draft and proposes it through the form: audited, and the validators are told', async () => {
      addOneOff();
      const href = await redirectOf(
        updateEvent('evt', {}, oneOff({ title: 'Nouveau titre', status: 'PROPOSED' })),
      );

      expect(href).toBe('/events/evt');
      expect(db.event('evt')).toMatchObject({
        title: 'Nouveau titre',
        status: 'PROPOSED',
        proposedAt: expect.any(Date),
      });
      expect(audit()).toEqual([
        { action: 'event.update', changed: ['title'] },
        { action: 'event.propose', from: 'DRAFT', to: 'PROPOSED' },
      ]);
      expect(notifyEventProposed).not.toHaveBeenCalled();
      await runAfterCallbacks();
      expect(notifyEventProposed).toHaveBeenCalledWith('evt');
      expect(notifyEventConfirmed).not.toHaveBeenCalled();
    });

    it('proposes a draft with one click: audited, the validators are told, nobody else', async () => {
      addOneOff();
      await expect(setEventStatus('evt', 'PROPOSED')).resolves.toEqual({ href: '/fr/events/evt' });

      expect(db.event('evt')).toMatchObject({ status: 'PROPOSED', proposedAt: expect.any(Date) });
      expect(audit()).toEqual([{ action: 'event.propose', from: 'DRAFT', to: 'PROPOSED' }]);
      await runAfterCallbacks();
      expect(notifyEventProposed).toHaveBeenCalledWith('evt');
      expect(notifyEventApproved).not.toHaveBeenCalled();
      expect(notifyEventConfirmed).not.toHaveBeenCalled();
    });

    it('withdraws a proposal: back to draft, audited as a withdrawal, nobody is told', async () => {
      addOneOff({ status: 'PROPOSED', proposedAt: new Date('2026-09-20T10:00:00Z') });
      await setEventStatus('evt', 'DRAFT');

      expect(db.event('evt')).toMatchObject({ status: 'DRAFT' });
      expect(audit()).toEqual([{ action: 'event.withdraw', from: 'PROPOSED', to: 'DRAFT' }]);
      expect(afterCallbacks).toHaveLength(0);
    });

    it('proposes a refused event again: the refusal is over, and the validators are told again', async () => {
      addOneOff(REFUSED);
      await setEventStatus('evt', 'PROPOSED');

      expect(db.event('evt')).toMatchObject({
        status: 'PROPOSED',
        refusalComment: null,
        refusedByLogin: null,
        refusedAt: null,
      });
      await runAfterCallbacks();
      expect(notifyEventProposed).toHaveBeenCalledWith('evt');
    });

    it('edits a refused event and keeps it a draft: the comment stays to be read', async () => {
      addOneOff(REFUSED);
      await redirectOf(updateEvent('evt', {}, oneOff({ location: 'Salle C' })));

      expect(db.event('evt')).toMatchObject({
        status: 'DRAFT',
        location: 'Salle C',
        refusalComment: 'Pas ce jour-là',
      });
      expect(afterCallbacks).toHaveLength(0);
    });

    it('saving a proposal again without changing anything writes nothing and tells nobody', async () => {
      addOneOff({ status: 'PROPOSED' });
      await redirectOf(updateEvent('evt', {}, oneOff({ status: 'PROPOSED' })));

      expect(audit()).toEqual([]);
      expect(afterCallbacks).toHaveLength(0);
    });

    it('edits a series as a whole, whatever scope the request claims: never one date of it', async () => {
      addEvent({ status: 'DRAFT', confirmationNotifiedAt: null });
      const data = withScope(
        formAt('2026-10-12', { title: 'Autre', status: 'DRAFT' }),
        'occurrence',
        OCT12,
      );
      await redirectOf(updateEvent('evt', {}, data));

      expect(db.event('evt')).toMatchObject({ title: 'Autre' });
      expect(db.table('eventOccurrence')).toEqual([]);
      expect(db.table('event')).toHaveLength(1);
    });

    it('proposes a whole series from any of its dates, without cutting it', async () => {
      addEvent({ status: 'DRAFT', confirmationNotifiedAt: null });
      await setEventStatus('evt', 'PROPOSED', OCT19.getTime(), 'occurrence');

      expect(db.table('event')).toHaveLength(1);
      expect(db.table('eventOccurrence')).toEqual([]);
      expect(db.event('evt')).toMatchObject({ status: 'PROPOSED' });
      expect(audit()).toEqual([
        {
          action: 'event.propose',
          scope: 'following',
          occurrenceStart: OCT5.toISOString(),
          fromFirst: true,
          from: 'DRAFT',
          to: 'PROPOSED',
        },
      ]);
    });

    it('cannot write the status of a published event, through the form either', async () => {
      addOneOff({ status: 'CONFIRMED' });
      await expect(updateEvent('evt', {}, oneOff({ status: 'DRAFT' }))).rejects.toThrow(
        'Forbidden',
      );
      await expect(updateEvent('evt', {}, oneOff({ title: 'Autre' }))).rejects.toThrow('Forbidden');
      expect(audit()).toEqual([]);
      expect(db.event('evt')).toMatchObject({ status: 'CONFIRMED', title: 'Training' });
    });

    it('cannot confirm their own proposal through the form', async () => {
      addOneOff({ status: 'PROPOSED' });
      await expect(updateEvent('evt', {}, oneOff({ status: 'CONFIRMED' }))).rejects.toThrow(
        'Forbidden',
      );
      expect(db.event('evt')).toMatchObject({ status: 'PROPOSED' });
      expect(audit()).toEqual([]);
    });

    it("cannot edit somebody else's event", async () => {
      addOneOff({ authorLogin: 'carol' });
      await expect(updateEvent('evt', {}, oneOff({ title: 'Autre' }))).rejects.toThrow('Forbidden');
      expect(db.event('evt')).toMatchObject({ title: 'Training' });
    });
  });

  describe('a validator', () => {
    beforeEach(() => asValidator());

    it('approves a proposal: published, audited as an approval, the author and the members are told', async () => {
      addOneOff({ status: 'PROPOSED', proposedAt: new Date('2026-09-20T10:00:00Z') });
      await expect(setEventStatus('evt', 'CONFIRMED')).resolves.toEqual({ href: '/fr/events/evt' });

      expect(db.event('evt')).toMatchObject({ status: 'CONFIRMED' });
      expect(audit()).toEqual([{ action: 'event.approve', from: 'PROPOSED', to: 'CONFIRMED' }]);
      await runAfterCallbacks();
      expect(notifyEventApproved).toHaveBeenCalledWith('evt', 'real-actor');
      expect(notifyEventConfirmed).toHaveBeenCalledWith('evt');
    });

    it('approves through the form as well: the same audit entry and notices', async () => {
      addOneOff({ status: 'PROPOSED' });
      await redirectOf(updateEvent('evt', {}, oneOff({ status: 'CONFIRMED' })));

      expect(audit()).toEqual([{ action: 'event.approve', from: 'PROPOSED', to: 'CONFIRMED' }]);
      await runAfterCallbacks();
      expect(notifyEventApproved).toHaveBeenCalledWith('evt', 'real-actor');
    });

    it('goes back to the list of proposals after an approval made from it', async () => {
      addOneOff({ status: 'PROPOSED' });
      await expect(
        setEventStatus('evt', 'CONFIRMED', undefined, undefined, 'review'),
      ).resolves.toEqual({ href: '/fr/events/review' });
    });

    it('approves a whole series from the list of proposals, from its first date', async () => {
      addEvent({ status: 'PROPOSED', confirmationNotifiedAt: null });
      await setEventStatus('evt', 'CONFIRMED', OCT5.getTime(), 'following', 'review');

      expect(db.event('evt')).toMatchObject({ status: 'CONFIRMED' });
      expect(audit()).toMatchObject([
        { action: 'event.approve', scope: 'following', fromFirst: true },
      ]);
      await runAfterCallbacks();
      expect(notifyEventConfirmed).toHaveBeenCalledWith('evt');
    });

    it('confirming a draft is not an approval: nobody is told that a proposal was approved', async () => {
      addOneOff();
      await setEventStatus('evt', 'CONFIRMED');

      expect(audit()).toEqual([{ action: 'event.status_change', from: 'DRAFT', to: 'CONFIRMED' }]);
      await runAfterCallbacks();
      expect(notifyEventApproved).not.toHaveBeenCalled();
      expect(notifyEventConfirmed).toHaveBeenCalledWith('evt');
    });

    it('clears a refusal when confirming the event that carried it', async () => {
      addOneOff(REFUSED);
      await setEventStatus('evt', 'CONFIRMED');
      expect(db.event('evt')).toMatchObject({
        status: 'CONFIRMED',
        refusalComment: null,
        refusedByLogin: null,
        refusedAt: null,
      });
    });

    it("edits a proposer's proposal and leaves it proposed: no new notice", async () => {
      addOneOff({ status: 'PROPOSED' });
      await redirectOf(updateEvent('evt', {}, oneOff({ status: 'PROPOSED', title: 'Corrigé' })));

      expect(db.event('evt')).toMatchObject({ status: 'PROPOSED', title: 'Corrigé' });
      expect(audit()).toEqual([{ action: 'event.update', changed: ['title'] }]);
      expect(afterCallbacks).toHaveLength(0);
    });

    it('edits a published event freely, whoever wrote it: it stays published, nobody is told', async () => {
      addOneOff({ status: 'CONFIRMED', authorLogin: 'carol' });
      await redirectOf(updateEvent('evt', {}, oneOff({ status: 'CONFIRMED', title: 'Corrigé' })));

      expect(db.event('evt')).toMatchObject({ status: 'CONFIRMED', title: 'Corrigé' });
      expect(audit()).toEqual([{ action: 'event.update', changed: ['title'] }]);
      expect(afterCallbacks).toHaveLength(0);
    });
  });

  describe('refusing a proposal', () => {
    beforeEach(() => asValidator());

    it('sends it back to draft with the comment, audited, and tells the author after the response', async () => {
      addOneOff({ status: 'PROPOSED' });
      await expect(refuseEvent('evt', '  Pas ce jour-là, la salle est prise.  ')).resolves.toEqual({
        href: '/fr/events/evt',
      });

      expect(db.event('evt')).toMatchObject({
        status: 'DRAFT',
        refusalComment: 'Pas ce jour-là, la salle est prise.',
        refusedByLogin: 'real-actor',
        refusedAt: expect.any(Date),
      });
      expect(audit()).toEqual([
        {
          action: 'event.refuse',
          comment: 'Pas ce jour-là, la salle est prise.',
          authorLogin: 'alice',
        },
      ]);
      expect(notifyEventRefused).not.toHaveBeenCalled();
      await runAfterCallbacks();
      expect(notifyEventRefused).toHaveBeenCalledWith('evt', 'real-actor');
      expect(notifyEventApproved).not.toHaveBeenCalled();
    });

    it('goes back to the list of proposals when it was answered from there', async () => {
      addOneOff({ status: 'PROPOSED' });
      await expect(refuseEvent('evt', 'Non.', 'review')).resolves.toEqual({
        href: '/fr/events/review',
      });
    });

    it('refuses a whole series, from its first date, and says so in the audit entry', async () => {
      addEvent({ status: 'PROPOSED', confirmationNotifiedAt: null });
      await refuseEvent('evt', 'Trop de dates.');

      expect(db.event('evt')).toMatchObject({ status: 'DRAFT', refusalComment: 'Trop de dates.' });
      expect(audit()).toEqual([
        {
          action: 'event.refuse',
          comment: 'Trop de dates.',
          authorLogin: 'alice',
          scope: 'following',
          occurrenceStart: OCT5.toISOString(),
          fromFirst: true,
        },
      ]);
    });

    it.each([
      ['nothing', ''],
      ['spaces only', '   \n '],
      ['more than 1000 characters', 'x'.repeat(1001)],
    ])('is not possible with a comment of %s', async (_label, comment) => {
      addOneOff({ status: 'PROPOSED' });
      await expect(refuseEvent('evt', comment)).rejects.toThrow('Invalid comment');
      expect(db.event('evt')).toMatchObject({ status: 'PROPOSED' });
      expect(db.event('evt')?.refusalComment ?? null).toBeNull();
      expect(audit()).toEqual([]);
      expect(afterCallbacks).toHaveLength(0);
    });

    it.each(['DRAFT', 'CONFIRMED'])(
      'is a notice, not an error, when somebody else already answered (the event is %s): nothing is written',
      async (status) => {
        addOneOff({ status });
        await expect(refuseEvent('evt', 'Trop tard.')).resolves.toEqual({
          href: '/fr/events/evt?notice=alreadyReviewed',
        });
        expect(db.event('evt')).toMatchObject({ status });
        expect(db.event('evt')?.refusalComment ?? null).toBeNull();
        expect(audit()).toEqual([]);
        expect(afterCallbacks).toHaveLength(0);
      },
    );

    it('is a notice when the event is gone', async () => {
      await expect(refuseEvent('nope', 'Non.')).resolves.toEqual({
        href: '/fr/events?notice=eventGone',
      });
      expect(afterCallbacks).toHaveLength(0);
    });
  });
});
