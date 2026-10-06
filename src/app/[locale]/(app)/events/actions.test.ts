import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, effectiveFor, memberWith, type AccountKind } from '@/test/session-fixtures';

/**
 * Every mutating action is its own HTTP entry point, so each must re-check
 * the "events" permission itself. These tests run the real access rules
 * (src/lib/events/access.ts) against mocked session/config/database and
 * prove that a refused caller produces no write, no audit entry and no
 * notification.
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
vi.mock('@/lib/auth/session', () => ({
  getEffectiveSession: vi.fn(),
  impersonationAuditFields: vi.fn(() => ({})),
}));
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback);
  }),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(
    (options: { href: string | { pathname: string; query: Record<string, string> } }) => {
      throw new RedirectSignal(
        typeof options.href === 'string'
          ? options.href
          : `${options.href.pathname}?${new URLSearchParams(options.href.query)}`,
      );
    },
  ),
}));
vi.mock('@/lib/events/notifications', () => ({ notifyEventConfirmed: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn() },
    event: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    eventCancellation: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { logAuditEvent } = await import('@/lib/audit-log');
const { after } = await import('next/server');
const { prisma } = await import('@/lib/prisma');
const { notifyEventConfirmed } = await import('@/lib/events/notifications');
const {
  cancelOccurrence,
  createEvent,
  deleteEvent,
  restoreOccurrence,
  setEventStatus,
  updateEvent,
} = await import('./actions');

type Who = AccountKind | { permissions: string[] } | null;

/** A member whose role manages events. */
const EVENT_MANAGER: Who = { permissions: ['events.view', 'events.manage'] };

interface Scenario {
  enabled?: boolean;
  who: Who;
}

function setup({ enabled = true, who }: Scenario) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { timezone: 'Europe/Paris' },
    modules: { enabled: enabled ? ['events'] : [] },
    events: {
      categories: [
        { key: 'soiree', label: 'Soirée', color: '#db2777' },
        { key: 'sport', label: 'Sport', color: '#16a34a' },
      ],
      reminderHour: 18,
    },
  } as unknown as ReturnType<typeof getConfig>);

  vi.mocked(getEffectiveSession).mockResolvedValue(
    who === null
      ? null
      : typeof who === 'string'
        ? effectiveFor(who, 'real-actor')
        : effective(memberWith(who.permissions, 'real-actor')),
  );
}

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  const defaults: Record<string, string | string[]> = {
    title: 'Soirée de rentrée',
    description: 'Venez nombreux',
    location: 'Salle B',
    categoryKey: 'soiree',
    startsAt: '2026-10-10T20:00',
    endsAt: '2026-10-11T02:00',
    recurrence: 'NONE',
    recurrenceUntil: '',
    status: 'DRAFT',
    assignees: [],
  };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const storedEvent = {
  id: 'evt1',
  title: 'Soirée de rentrée',
  description: 'Venez nombreux',
  location: 'Salle B',
  categoryKey: 'soiree',
  status: 'DRAFT' as const,
  startsAt: new Date('2026-10-10T18:00:00Z'),
  endsAt: new Date('2026-10-11T00:00:00Z'),
  recurrence: 'NONE' as const,
  recurrenceUntil: null,
  schoolYear: '2026-2027',
  confirmationNotifiedAt: null,
  authorLogin: 'someone',
  authorId: null,
  assignees: [{ login: 'alice' }],
};

const series = {
  ...storedEvent,
  recurrence: 'WEEKLY' as const,
  recurrenceUntil: new Date('2026-10-31T21:00:00Z'),
};

const FORBIDDEN: [string, Scenario][] = [
  ['no session', { who: null }],
  ['a PENDING account', { who: 'PENDING' }],
  ['the default member (can only view)', { who: 'MEMBER' }],
  ['a role that only views events', { who: { permissions: ['events.view'] } }],
  [
    'a role that holds only another module',
    { who: { permissions: ['events.view', 'finance.manage'] } },
  ],
  [
    'a role that only manages the shared calendar',
    { who: { permissions: ['events.shared_calendar'] } },
  ],
  ['the OWNER when the module is disabled', { who: 'OWNER', enabled: false }],
];

function expectNothingHappened() {
  expect(prisma.event.create).not.toHaveBeenCalled();
  expect(prisma.event.update).not.toHaveBeenCalled();
  expect(prisma.event.delete).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
  expect(prisma.eventCancellation.deleteMany).not.toHaveBeenCalled();
  expect(logAuditEvent).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
}

async function runAfterCallbacks() {
  for (const callback of afterCallbacks.splice(0)) await callback();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(prisma.event.findUnique).mockResolvedValue(storedEvent as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
});

describe('access control on every action', () => {
  describe.each(FORBIDDEN)('%s', (_label, scenario) => {
    beforeEach(() => setup(scenario));

    it('cannot create an event', async () => {
      await expect(createEvent({}, form({}))).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot update an event', async () => {
      await expect(updateEvent('evt1', {}, form({}))).rejects.toThrow('Forbidden');
      expect(prisma.event.findUnique).not.toHaveBeenCalled();
      expectNothingHappened();
    });

    it('cannot delete an event', async () => {
      await expect(deleteEvent('evt1')).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot change an event status', async () => {
      await expect(setEventStatus('evt1', 'CONFIRMED')).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot cancel an occurrence', async () => {
      await expect(cancelOccurrence('evt1', 1)).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot restore an occurrence', async () => {
      await expect(restoreOccurrence('evt1', 1)).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });
  });
});

describe('createEvent', () => {
  beforeEach(() => {
    setup({ who: EVENT_MANAGER });
    vi.mocked(prisma.event.create).mockResolvedValue({ ...storedEvent } as never);
  });

  it('stores UTC dates, the school year and the real author, then redirects to the event', async () => {
    await expect(createEvent({}, form({}))).rejects.toThrow(new RedirectSignal('/events/evt1'));

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Soirée de rentrée',
        startsAt: new Date('2026-10-10T18:00:00Z'),
        endsAt: new Date('2026-10-11T00:00:00Z'),
        schoolYear: '2026-2027',
        status: 'DRAFT',
        authorLogin: 'real-actor',
        authorId: 'actor-1',
      }),
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorLogin: 'real-actor',
        action: 'event.create',
        targetType: 'Event',
        targetId: 'evt1',
      }),
    );
  });

  it('works for the OWNER without an explicit permission row', async () => {
    setup({ who: 'OWNER' });
    await expect(createEvent({}, form({}))).rejects.toThrow(RedirectSignal);
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
  });

  it('assigns the members in charge by login and account', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'u-alice', login: 'alice' }] as never);
    await expect(createEvent({}, form({ assignees: ['alice'] }))).rejects.toThrow(RedirectSignal);
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignees: { create: [{ login: 'alice', userId: 'u-alice' }] },
      }),
    });
  });

  it('returns field errors and keeps the typed values when the form is invalid', async () => {
    const state = await createEvent({}, form({ title: '', endsAt: '2026-10-10T19:00' }));
    expect(state.errors).toEqual({ title: 'required', endsAt: 'endBeforeStart' });
    expect(state.values?.location).toBe('Salle B');
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it.each(['title', 'description', 'location', 'startsAt', 'endsAt'])(
    'refuses to save without %s, server side',
    async (name) => {
      const state = await createEvent({}, form({ [name]: '' }));
      expect(state.errors?.[name as keyof typeof state.errors]).toBe('required');
      expect(prisma.event.create).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    },
  );

  it('refuses a whitespace-only description or location', async () => {
    const state = await createEvent({}, form({ description: '   ', location: '  ' }));
    expect(state.errors).toEqual({ description: 'required', location: 'required' });
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('keeps the members in charge optional', async () => {
    await expect(createEvent({}, form({ assignees: [] }))).rejects.toThrow(RedirectSignal);
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a member in charge that is unknown or still pending', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    const state = await createEvent({}, form({ assignees: ['ghost'] }));
    expect(state.formError).toBe('invalidAssignee');
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('rejects a category that is not in the configuration', async () => {
    const state = await createEvent({}, form({ categoryKey: 'hack' }));
    expect(state.errors?.categoryKey).toBe('invalid');
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('does not announce a draft', async () => {
    await expect(createEvent({}, form({}))).rejects.toThrow(RedirectSignal);
    expect(after).not.toHaveBeenCalled();
  });

  it('announces a confirmed event after the response, not before', async () => {
    vi.mocked(prisma.event.create).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    await expect(createEvent({}, form({ status: 'CONFIRMED' }))).rejects.toThrow(RedirectSignal);

    expect(after).toHaveBeenCalledTimes(1);
    expect(notifyEventConfirmed).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(notifyEventConfirmed).toHaveBeenCalledWith('evt1');
  });

  it('still saves the event when the notification fails', async () => {
    vi.mocked(prisma.event.create).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    vi.mocked(notifyEventConfirmed).mockRejectedValue(new Error('SMTP down'));

    await expect(createEvent({}, form({ status: 'CONFIRMED' }))).rejects.toThrow(
      new RedirectSignal('/events/evt1'),
    );
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'event.create' }));

    // Running the deferred work later must not throw either.
    await expect(runAfterCallbacks()).resolves.toBeUndefined();
  });
});

describe('updateEvent', () => {
  beforeEach(() => {
    setup({ who: EVENT_MANAGER });
    vi.mocked(prisma.$transaction).mockImplementation((async (operations: unknown[]) =>
      Promise.all(operations)) as never);
    vi.mocked(prisma.event.update).mockResolvedValue({ ...storedEvent } as never);
  });

  it('reports a missing event without writing', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    const state = await updateEvent('nope', {}, form({}));
    expect(state.formError).toBe('notFound');
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('audits the changed fields only', async () => {
    await expect(updateEvent('evt1', {}, form({ title: 'Nouveau titre' }))).rejects.toThrow(
      RedirectSignal,
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'event.update',
        metadata: expect.objectContaining({ changed: ['title', 'assignees'] }),
      }),
    );
  });

  it('logs a status change and announces the confirmation', async () => {
    vi.mocked(prisma.event.update).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    await expect(updateEvent('evt1', {}, form({ status: 'CONFIRMED' }))).rejects.toThrow(
      RedirectSignal,
    );

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'event.status_change',
        metadata: expect.objectContaining({ from: 'DRAFT', to: 'CONFIRMED' }),
      }),
    );
    await runAfterCallbacks();
    expect(notifyEventConfirmed).toHaveBeenCalledWith('evt1');
  });

  it('does not announce an edit of an already confirmed event', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    vi.mocked(prisma.event.update).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    await expect(updateEvent('evt1', {}, form({ status: 'CONFIRMED' }))).rejects.toThrow(
      RedirectSignal,
    );
    expect(after).not.toHaveBeenCalled();
  });

  describe('events saved before location and description became mandatory', () => {
    const legacy = { ...storedEvent, description: null, location: null };

    beforeEach(() => {
      vi.mocked(prisma.event.findUnique).mockResolvedValue(legacy as never);
    });

    it('are not blocked until they are edited: the next edit must fill both in', async () => {
      const state = await updateEvent('evt1', {}, form({ description: '', location: '' }));
      expect(state.errors).toEqual({ description: 'required', location: 'required' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('can be saved once the missing fields are filled in', async () => {
      await expect(
        updateEvent('evt1', {}, form({ description: 'Enfin décrit', location: 'Salle C' })),
      ).rejects.toThrow(RedirectSignal);
      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: 'Enfin décrit', location: 'Salle C' }),
        }),
      );
    });

    it('can still be confirmed without being edited', async () => {
      vi.mocked(prisma.event.update).mockResolvedValue({
        ...legacy,
        status: 'CONFIRMED',
      } as never);
      await expect(setEventStatus('evt1', 'CONFIRMED')).resolves.toBeUndefined();
    });
  });

  it('drops cancellations of occurrences that no longer exist after the series changed', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(series as never);
    await expect(
      updateEvent(
        'evt1',
        {},
        form({ recurrence: 'WEEKLY', recurrenceUntil: '2026-10-31', assignees: [] }),
      ),
    ).rejects.toThrow(RedirectSignal);

    expect(prisma.eventCancellation.deleteMany).toHaveBeenCalledWith({
      where: {
        eventId: 'evt1',
        occurrenceStart: {
          notIn: [
            new Date('2026-10-10T18:00:00Z'),
            new Date('2026-10-17T18:00:00Z'),
            new Date('2026-10-24T18:00:00Z'),
            new Date('2026-10-31T19:00:00Z'), // after the DST change (UTC+1)
          ],
        },
      },
    });
  });
});

describe('deleteEvent and setEventStatus', () => {
  beforeEach(() => setup({ who: EVENT_MANAGER }));

  it('deletes the event, audits it with its title, and returns to the list', async () => {
    await expect(deleteEvent('evt1')).rejects.toThrow(new RedirectSignal('/events'));
    expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 'evt1' } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'event.delete',
        targetLabel: 'Soirée de rentrée',
        actorLogin: 'real-actor',
      }),
    );
  });

  // Expected cases, not failures: someone else deleted the event while this page was open.
  describe('when the event is already gone', () => {
    beforeEach(() => {
      vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    });
    const gone = new RedirectSignal('/events?notice=eventGone');

    it('deleting it again goes back to the list with a message, writes nothing', async () => {
      await expect(deleteEvent('evt1')).rejects.toThrow(gone);
      expect(prisma.event.delete).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('changing its status goes back to the list with a message, writes nothing', async () => {
      await expect(setEventStatus('evt1', 'CONFIRMED')).rejects.toThrow(gone);
      expect(prisma.event.update).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('cancelling or restoring one of its dates goes back to the list with a message', async () => {
      await expect(cancelOccurrence('evt1', 1)).rejects.toThrow(gone);
      await expect(restoreOccurrence('evt1', 1)).rejects.toThrow(gone);
      expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
      expect(prisma.eventCancellation.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('rejects an unknown status value', async () => {
    await expect(setEventStatus('evt1', 'ARCHIVED' as never)).rejects.toThrow('Invalid status');
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('does nothing when the status is already the requested one', async () => {
    await setEventStatus('evt1', 'DRAFT');
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('confirms an event, audits the change and announces it', async () => {
    vi.mocked(prisma.event.update).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    await setEventStatus('evt1', 'CONFIRMED');

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.status_change' }),
    );
    await runAfterCallbacks();
    expect(notifyEventConfirmed).toHaveBeenCalledWith('evt1');
  });

  it('does not announce when going back to draft', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      ...storedEvent,
      status: 'CONFIRMED',
    } as never);
    vi.mocked(prisma.event.update).mockResolvedValue({ ...storedEvent } as never);
    await setEventStatus('evt1', 'DRAFT');
    expect(after).not.toHaveBeenCalled();
  });
});

describe('cancelOccurrence / restoreOccurrence', () => {
  const second = new Date('2026-10-17T18:00:00Z').getTime();

  beforeEach(() => {
    setup({ who: EVENT_MANAGER });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(series as never);
  });

  it('cancels one occurrence of a series and audits it', async () => {
    await cancelOccurrence('evt1', second);

    expect(prisma.eventCancellation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_occurrenceStart: { eventId: 'evt1', occurrenceStart: new Date(second) },
        },
        create: expect.objectContaining({ cancelledByLogin: 'real-actor' }),
      }),
    );
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.event.delete).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'event.occurrence_cancel',
        metadata: expect.objectContaining({ occurrenceStart: '2026-10-17T18:00:00.000Z' }),
      }),
    );
  });

  it('refuses an instant that is not an occurrence of the series', async () => {
    await expect(cancelOccurrence('evt1', second + 60_000)).rejects.toThrow(
      new RedirectSignal('/events/evt1?notice=occurrenceGone'),
    );
    expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
  });

  it('refuses to cancel an occurrence of a one-off event', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(storedEvent as never);
    await expect(cancelOccurrence('evt1', storedEvent.startsAt.getTime())).rejects.toThrow(
      new RedirectSignal('/events/evt1?notice=occurrenceGone'),
    );
    expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
  });

  it('restores a cancelled occurrence and audits it', async () => {
    await restoreOccurrence('evt1', second);
    expect(prisma.eventCancellation.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt1', occurrenceStart: new Date(second) },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.occurrence_restore' }),
    );
  });
});
