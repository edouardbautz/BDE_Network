import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, effectiveFor, memberWith, type AccountKind } from '@/test/session-fixtures';

/**
 * Every mutating action is its own HTTP entry point, so each must re-check
 * the "events" permissions itself (who may propose, who may validate). These tests run the real access rules
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
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: vi.fn() }));
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
    (options: { href: string | { pathname: string; query: Record<string, string> } }) => {
      throw new RedirectSignal(
        typeof options.href === 'string'
          ? options.href
          : `${options.href.pathname}?${new URLSearchParams(options.href.query)}`,
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
const { notifyEventConfirmed, notifyEventProposed } = await import('@/lib/events/notifications');
const {
  cancelOccurrence,
  createEvent,
  deleteEvent,
  deleteFollowingDates,
  restoreOccurrence,
  setEventStatus,
  updateEvent,
} = await import('./actions');

type Who = AccountKind | { permissions: string[] } | null;

/** A member whose role validates events (and so proposes them too). */
const EVENT_VALIDATOR: Who = { permissions: ['events.view', 'events.validate'] };

/** A member whose role only proposes events. */
const EVENT_PROPOSER: Who = { permissions: ['events.view', 'events.propose'] };

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
    repeat: 'NONE',
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
  repeat: null,
  recurrenceUntil: null,
  schoolYear: '2026-2027',
  confirmationNotifiedAt: null,
  authorLogin: 'someone',
  authorId: null,
  assignees: [{ login: 'alice' }],
  cancellations: [],
  occurrences: [],
};

const series = {
  ...storedEvent,
  repeat: { freq: 'WEEKLY', interval: 1 },
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
  // A transaction runs its work against the same mocks.
  vi.mocked(prisma.$transaction).mockImplementation((async (work: (tx: unknown) => unknown) =>
    work(prisma)) as never);
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

    it('cannot change the status of one date or of the following', async () => {
      await expect(setEventStatus('evt1', 'CONFIRMED', 1, 'occurrence')).rejects.toThrow(
        'Forbidden',
      );
      await expect(setEventStatus('evt1', 'DRAFT', 1, 'following')).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot delete a date and the following', async () => {
      await expect(deleteFollowingDates('evt1', 1)).rejects.toThrow('Forbidden');
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
    setup({ who: EVENT_VALIDATOR });
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
      prisma,
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
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.create' }),
      prisma,
    );

    // Running the deferred work later must not throw either.
    await expect(runAfterCallbacks()).resolves.toBeUndefined();
  });
});

describe('deleteEvent and setEventStatus', () => {
  beforeEach(() => setup({ who: EVENT_VALIDATOR }));

  it('deletes the event, audits it with its title, and returns to the list', async () => {
    await expect(deleteEvent('evt1')).rejects.toThrow(new RedirectSignal('/events'));
    expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 'evt1' } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'event.delete',
        targetLabel: 'Soirée de rentrée',
        actorLogin: 'real-actor',
      }),
      prisma,
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
      await expect(setEventStatus('evt1', 'CONFIRMED')).resolves.toEqual({
        href: '/fr/events?notice=eventGone',
      });
      expect(prisma.event.update).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('cancelling or restoring one of its dates goes back to the list with a message', async () => {
      const goneHref = { href: '/fr/events?notice=eventGone' };
      await expect(cancelOccurrence('evt1', 1)).resolves.toEqual(goneHref);
      await expect(restoreOccurrence('evt1', 1)).resolves.toEqual(goneHref);
      expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
      expect(prisma.eventCancellation.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('rejects an unknown status value', async () => {
    await expect(setEventStatus('evt1', 'ARCHIVED' as never)).rejects.toThrow('Invalid status');
    expect(prisma.event.update).not.toHaveBeenCalled();
  });
});

describe('cancelOccurrence / restoreOccurrence', () => {
  const second = new Date('2026-10-17T18:00:00Z').getTime();

  beforeEach(() => {
    setup({ who: EVENT_VALIDATOR });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(series as never);
  });

  it('cancels one occurrence of a series and audits it, then points at that date', async () => {
    await expect(cancelOccurrence('evt1', second)).resolves.toEqual({
      href: `/fr/events/evt1?occ=${second}`,
    });

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
        metadata: expect.objectContaining({
          scope: 'occurrence',
          occurrenceStart: '2026-10-17T18:00:00.000Z',
        }),
      }),
    );
  });

  it('refuses an instant that is not an occurrence of the series', async () => {
    await expect(cancelOccurrence('evt1', second + 60_000)).resolves.toEqual({
      href: '/fr/events/evt1?notice=occurrenceGone',
    });
    expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
  });

  it('refuses to cancel an occurrence of a one-off event', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(storedEvent as never);
    await expect(cancelOccurrence('evt1', storedEvent.startsAt.getTime())).resolves.toEqual({
      href: '/fr/events/evt1?notice=occurrenceGone',
    });
    expect(prisma.eventCancellation.upsert).not.toHaveBeenCalled();
  });

  it('restores a cancelled occurrence and audits it, then points at that date', async () => {
    await expect(restoreOccurrence('evt1', second)).resolves.toEqual({
      href: `/fr/events/evt1?occ=${second}`,
    });
    expect(prisma.eventCancellation.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt1', occurrenceStart: new Date(second) },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.occurrence_restore' }),
    );
  });
});

// ---- the proposal circuit ---------------------------------------------------------------------------------------

/** An event written by the person acting (the mocked actor is "real-actor"). */
const own = (extra: Record<string, unknown> = {}) =>
  ({ ...storedEvent, authorLogin: 'real-actor', ...extra }) as never;

describe('what somebody who only proposes can never do', () => {
  beforeEach(() => setup({ who: EVENT_PROPOSER }));

  // Cancelling a date, restoring it and cutting a series are a validator's: nothing is written, nothing is audited.
  it('cannot delete a date and the following', async () => {
    await expect(deleteFollowingDates('evt1', 1)).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot cancel or restore an occurrence', async () => {
    await expect(cancelOccurrence('evt1', 1)).rejects.toThrow('Forbidden');
    await expect(restoreOccurrence('evt1', 1)).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot create a confirmed event, even by crafting the request', async () => {
    await expect(createEvent({}, form({ status: 'CONFIRMED' }))).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot confirm an event, not even their own draft', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(own());
    await expect(setEventStatus('evt1', 'CONFIRMED')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot confirm a proposal of their own: approving is for a validator', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(own({ status: 'PROPOSED' }));
    await expect(setEventStatus('evt1', 'CONFIRMED')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it("cannot touch somebody else's draft or proposal", async () => {
    for (const status of ['DRAFT', 'PROPOSED'] as const) {
      vi.mocked(prisma.event.findUnique).mockResolvedValue({ ...storedEvent, status } as never);
      await expect(setEventStatus('evt1', 'PROPOSED')).rejects.toThrow('Forbidden');
      await expect(setEventStatus('evt1', 'DRAFT')).rejects.toThrow('Forbidden');
      await expect(updateEvent('evt1', {}, form({}))).rejects.toThrow('Forbidden');
      await expect(deleteEvent('evt1')).rejects.toThrow('Forbidden');
    }
    expectNothingHappened();
  });

  it('cannot edit, change the status of or delete a published event, even their own', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(own({ status: 'CONFIRMED' }));
    await expect(updateEvent('evt1', {}, form({}))).rejects.toThrow('Forbidden');
    await expect(setEventStatus('evt1', 'DRAFT')).rejects.toThrow('Forbidden');
    await expect(setEventStatus('evt1', 'PROPOSED')).rejects.toThrow('Forbidden');
    await expect(deleteEvent('evt1')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot touch an unpublished event of which one date was confirmed alone: it is published', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      own({ occurrences: [{ status: 'CONFIRMED' }] }),
    );
    await expect(updateEvent('evt1', {}, form({}))).rejects.toThrow('Forbidden');
    await expect(deleteEvent('evt1')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot refuse a proposal', async () => {
    const { refuseEvent } = await import('./actions');
    await expect(refuseEvent('evt1', 'Non.')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });
});

describe('what a validator can never do to a proposal', () => {
  beforeEach(() => setup({ who: EVENT_VALIDATOR }));

  it('cannot make a proposal of their own: they have nobody to propose to', async () => {
    await expect(createEvent({}, form({ status: 'PROPOSED' }))).rejects.toThrow('Forbidden');
    vi.mocked(prisma.event.findUnique).mockResolvedValue(storedEvent as never);
    await expect(setEventStatus('evt1', 'PROPOSED')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('cannot send a proposal back to draft without a comment: that is refusing it', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      ...storedEvent,
      status: 'PROPOSED',
    } as never);
    await expect(setEventStatus('evt1', 'DRAFT')).rejects.toThrow('Forbidden');
    expectNothingHappened();
  });

  it('refuses an answer that goes nowhere the application knows', async () => {
    const { refuseEvent } = await import('./actions');
    await expect(refuseEvent('evt1', 'Non.', 'https://elsewhere.example')).rejects.toThrow(
      'Invalid target',
    );
    await expect(setEventStatus('evt1', 'CONFIRMED', undefined, undefined, '//x')).rejects.toThrow(
      'Invalid target',
    );
    expectNothingHappened();
  });
});

describe('proposing an event', () => {
  beforeEach(() => {
    setup({ who: EVENT_PROPOSER });
    vi.mocked(prisma.event.create).mockResolvedValue({
      ...storedEvent,
      status: 'PROPOSED',
      authorLogin: 'real-actor',
    } as never);
  });

  it('stores a proposal under the real author, audits the creation and the proposal in one transaction', async () => {
    await expect(createEvent({}, form({ status: 'PROPOSED' }))).rejects.toThrow(
      new RedirectSignal('/events/evt1'),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'PROPOSED',
        proposedAt: expect.any(Date),
        authorLogin: 'real-actor',
        authorId: 'actor-1',
      }),
    });
    const actions = vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry.action);
    expect(actions).toEqual(['event.create', 'event.propose']);
    expect(vi.mocked(logAuditEvent).mock.calls[1]?.[0]).toMatchObject({
      actorLogin: 'real-actor',
      targetId: 'evt1',
      metadata: { created: true },
    });
  });

  it('tells the validators after the response, and does not announce it to the members', async () => {
    await expect(createEvent({}, form({ status: 'PROPOSED' }))).rejects.toThrow(RedirectSignal);

    expect(after).toHaveBeenCalledTimes(1);
    expect(notifyEventProposed).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(notifyEventProposed).toHaveBeenCalledWith('evt1');
    expect(notifyEventConfirmed).not.toHaveBeenCalled();
  });

  it('still saves the proposal when the notification fails', async () => {
    vi.mocked(notifyEventProposed).mockRejectedValue(new Error('Discord down'));
    await expect(createEvent({}, form({ status: 'PROPOSED' }))).rejects.toThrow(RedirectSignal);
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
    await expect(runAfterCallbacks()).resolves.toBeUndefined();
  });

  it('proposes a series with its rule and its end', async () => {
    await expect(
      createEvent(
        {},
        form({
          status: 'PROPOSED',
          repeat: 'CUSTOM',
          repeatFreq: 'WEEKLY',
          repeatInterval: '2',
          repeatWeekdays: ['MO', 'WE'],
          repeatEnd: 'count',
          repeatCount: '10',
        }),
      ),
    ).rejects.toThrow(RedirectSignal);

    const { data } = vi.mocked(prisma.event.create).mock.calls[0]![0] as {
      data: { repeat: unknown; recurrenceUntil: Date; startsAt: Date; status: string };
    };
    expect(data).toMatchObject({
      status: 'PROPOSED',
      repeat: { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 },
    });
    // the first date typed (a Saturday) moved to the first that fits (the Monday after), and the weeks are counted from
    // it; the series ends where its tenth date starts (Wednesday 9 December)
    expect(data.startsAt).toEqual(new Date('2026-10-12T18:00:00Z'));
    expect(data.recurrenceUntil).toEqual(new Date('2026-12-09T19:00:00Z'));
  });

  it('refuses to propose a series with more dates than an event holds: nothing is stored', async () => {
    const result = await createEvent(
      {},
      form({
        status: 'PROPOSED',
        repeat: 'DAILY',
        repeatEnd: 'until',
        recurrenceUntil: '2040-01-01',
      }),
    );
    expect(result.errors).toEqual({ recurrenceUntil: 'tooManyOccurrences' });
    expect(prisma.event.create).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('keeps a draft private: nothing is proposed, nobody is told', async () => {
    vi.mocked(prisma.event.create).mockResolvedValue(own());
    await expect(createEvent({}, form({ status: 'DRAFT' }))).rejects.toThrow(RedirectSignal);
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ proposedAt: expect.anything() }),
    });
    expect(vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry.action)).toEqual([
      'event.create',
    ]);
    expect(after).not.toHaveBeenCalled();
  });
});

describe('deleting an event', () => {
  it('lets a proposer withdraw their own draft or proposal', async () => {
    setup({ who: EVENT_PROPOSER });
    for (const status of ['DRAFT', 'PROPOSED'] as const) {
      vi.mocked(prisma.event.delete).mockClear();
      vi.mocked(prisma.event.findUnique).mockResolvedValue(own({ status }));
      await expect(deleteEvent('evt1')).rejects.toThrow(new RedirectSignal('/events'));
      expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 'evt1' } });
    }
  });

  it('checks again, inside the transaction, that nobody published the event meanwhile', async () => {
    setup({ who: EVENT_PROPOSER });
    vi.mocked(prisma.event.findUnique)
      .mockResolvedValueOnce(own({ status: 'PROPOSED' })) // what the page showed
      .mockResolvedValueOnce(own({ status: 'CONFIRMED' })); // what a validator did meanwhile
    await expect(deleteEvent('evt1')).rejects.toThrow('Forbidden');
    expect(prisma.event.delete).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('lets a validator delete any event, published or not, whoever wrote it', async () => {
    setup({ who: EVENT_VALIDATOR });
    for (const status of ['DRAFT', 'PROPOSED', 'CONFIRMED'] as const) {
      vi.mocked(prisma.event.delete).mockClear();
      vi.mocked(prisma.event.findUnique).mockResolvedValue({ ...storedEvent, status } as never);
      await expect(deleteEvent('evt1')).rejects.toThrow(new RedirectSignal('/events'));
      expect(prisma.event.delete).toHaveBeenCalledTimes(1);
    }
  });
});
