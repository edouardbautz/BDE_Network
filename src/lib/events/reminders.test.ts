import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { event: { findMany: vi.fn() }, eventReminder: { create: vi.fn() } },
}));
vi.mock('@/lib/notifications/recipients', () => ({ emailsOfHolders: vi.fn() }));
vi.mock('./messages', () => ({
  buildReminderMessage: vi.fn(() => ({ subject: 'Rappel', body: 'Demain' })),
}));
vi.mock('./notifications', () => ({
  deliver: vi.fn(async () => ({ sent: 1, failed: 0 })),
  getTranslate: vi.fn(async () => (key: string) => key),
  toNotificationData: vi.fn(() => ({})),
}));

const { getConfig } = await import('@/config');
const { prisma } = await import('@/lib/prisma');
const { deliver } = await import('./notifications');
const { emailsOfHolders } = await import('@/lib/notifications/recipients');
const { reminderDueAt, runReminderTick } = await import('./reminders');

const PARIS = 'Europe/Paris';

function setConfig(options: { enabled?: boolean; channel?: string } = {}) {
  const enabled = options.enabled ?? true;
  vi.mocked(getConfig).mockReturnValue({
    bde: { timezone: PARIS, defaultLocale: 'fr' },
    modules: { enabled: enabled ? ['events'] : [] },
    events: { categories: [], reminderHour: 18 },
    notifications: { eventReminder: options.channel ?? 'email' },
  } as unknown as ReturnType<typeof getConfig>);
}

interface StoredEvent {
  id: string;
  startsAt: Date;
  endsAt: Date;
  recurrence: 'NONE' | 'WEEKLY';
  recurrenceUntil: Date | null;
  confirmationNotifiedAt: Date | null;
  assignees: { login: string; user: { fullName: string; email: string } | null }[];
  cancellations: { occurrenceStart: Date }[];
}

function event(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 'evt1',
    // Saturday 10 Oct 2026, 20:00 Paris (UTC+2)
    startsAt: new Date('2026-10-10T18:00:00Z'),
    endsAt: new Date('2026-10-10T21:00:00Z'),
    recurrence: 'NONE',
    recurrenceUntil: null,
    confirmationNotifiedAt: new Date('2026-09-01T10:00:00Z'),
    assignees: [{ login: 'alice', user: { fullName: 'Alice', email: 'alice@x.fr' } }],
    cancellations: [],
    ...overrides,
  };
}

/** A tiny in-memory stand-in for the unique (event, occurrence) index. */
function fakeClaimTable() {
  const claimed = new Set<string>();
  vi.mocked(prisma.eventReminder.create).mockImplementation((async ({
    data,
  }: {
    data: { eventId: string; occurrenceStart: Date };
  }) => {
    const key = `${data.eventId}:${data.occurrenceStart.getTime()}`;
    if (claimed.has(key)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    claimed.add(key);
    return data;
  }) as never);
  return claimed;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  setConfig();
  fakeClaimTable();
});

describe('reminderDueAt', () => {
  it('is reminderHour on the local day before the occurrence', () => {
    // 10 Oct 20:00 Paris → due 9 Oct 18:00 Paris = 16:00 UTC (summer time)
    expect(reminderDueAt(new Date('2026-10-10T18:00:00Z'), PARIS, 18)).toEqual(
      new Date('2026-10-09T16:00:00Z'),
    );
  });

  it('uses the local day, so an after-midnight start is reminded two UTC days earlier', () => {
    // 11 Oct 00:30 Paris = 10 Oct 22:30 UTC → local day is the 11th → due 10 Oct 18:00 Paris
    expect(reminderDueAt(new Date('2026-10-10T22:30:00Z'), PARIS, 18)).toEqual(
      new Date('2026-10-10T16:00:00Z'),
    );
  });

  it('handles the DST change between the reminder and the event', () => {
    // Sun 25 Oct 2026 09:00 Paris (UTC+1) → due Sat 24 Oct 18:00 Paris (UTC+2) = 16:00 UTC
    expect(reminderDueAt(new Date('2026-10-25T08:00:00Z'), PARIS, 18)).toEqual(
      new Date('2026-10-24T16:00:00Z'),
    );
  });
});

describe('runReminderTick', () => {
  it('does nothing when the events module is disabled', async () => {
    setConfig({ enabled: false });
    await expect(runReminderTick(new Date('2026-10-09T17:00:00Z'))).resolves.toEqual({
      claimed: 0,
    });
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it('only queries confirmed events', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    await runReminderTick(new Date('2026-10-09T17:00:00Z'));
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('does not send before the reminder is due', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    // 15:59 UTC on 9 Oct = 17:59 Paris, one minute early
    await runReminderTick(new Date('2026-10-09T15:59:00Z'));
    expect(prisma.eventReminder.create).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('sends once the reminder is due, to the members in charge', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    const result = await runReminderTick(new Date('2026-10-09T16:00:00Z'));
    expect(result.claimed).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith('eventReminder', expect.anything(), ['alice@x.fr']);
  });

  it('never sends the same reminder twice, however many ticks run', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    for (const minutes of [0, 5, 10, 15, 600]) {
      await runReminderTick(new Date(Date.parse('2026-10-09T16:00:00Z') + minutes * 60_000));
    }
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('never sends twice across a restart (a fresh process reads the same claim table)', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    await runReminderTick(new Date('2026-10-09T16:05:00Z'));
    // "Restart": nothing in memory survives except the database rows.
    vi.resetModules();
    await runReminderTick(new Date('2026-10-09T16:10:00Z'));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('lets only one of two concurrent instances send', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    const now = new Date('2026-10-09T17:00:00Z');
    await Promise.all([runReminderTick(now), runReminderTick(now)]);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('catches up if the instance was down at the usual time', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    // Back online at 11:00 Paris on the day of the event (due since the evening
    // before, start at 20:00): the reminder still goes out.
    await runReminderTick(new Date('2026-10-10T09:00:00Z'));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('does not send for an occurrence that has already started', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    await runReminderTick(new Date('2026-10-10T18:30:00Z'));
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not remind a cancelled occurrence but still reminds the next one', async () => {
    const series = event({
      recurrence: 'WEEKLY',
      recurrenceUntil: new Date('2026-10-31T00:00:00Z'),
      cancellations: [{ occurrenceStart: new Date('2026-10-10T18:00:00Z') }],
    });
    vi.mocked(prisma.event.findMany).mockResolvedValue([series] as never);

    await runReminderTick(new Date('2026-10-09T17:00:00Z'));
    expect(deliver).not.toHaveBeenCalled();

    await runReminderTick(new Date('2026-10-16T17:00:00Z'));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('reminds each occurrence of a series separately', async () => {
    const series = event({
      recurrence: 'WEEKLY',
      recurrenceUntil: new Date('2026-10-31T00:00:00Z'),
    });
    vi.mocked(prisma.event.findMany).mockResolvedValue([series] as never);

    await runReminderTick(new Date('2026-10-09T17:00:00Z'));
    await runReminderTick(new Date('2026-10-16T17:00:00Z'));
    await runReminderTick(new Date('2026-10-16T18:00:00Z'));

    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('skips events confirmed after the reminder was due (members were just told)', async () => {
    const late = event({ confirmationNotifiedAt: new Date('2026-10-09T17:30:00Z') });
    vi.mocked(prisma.event.findMany).mockResolvedValue([late] as never);
    await runReminderTick(new Date('2026-10-09T18:00:00Z'));
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not send when the claim fails for a reason other than "already claimed"', async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);
    vi.mocked(prisma.eventReminder.create).mockRejectedValue(new Error('db down'));
    await expect(runReminderTick(new Date('2026-10-09T17:00:00Z'))).resolves.toEqual({
      claimed: 0,
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  describe('when nobody is in charge to write to', () => {
    const now = new Date('2026-10-09T17:00:00Z');

    it('goes to the people who can manage the events, not to no one', async () => {
      vi.mocked(emailsOfHolders).mockResolvedValue(['owner@x.fr', 'resp@x.fr']);
      vi.mocked(prisma.event.findMany).mockResolvedValue([event({ assignees: [] })] as never);

      await runReminderTick(now);

      expect(emailsOfHolders).toHaveBeenCalledExactlyOnceWith('events.manage');
      expect(deliver).toHaveBeenCalledWith('eventReminder', expect.anything(), [
        'owner@x.fr',
        'resp@x.fr',
      ]);
    });

    it('does the same when the people in charge no longer have an account', async () => {
      vi.mocked(emailsOfHolders).mockResolvedValue(['owner@x.fr']);
      const orphan = event({ assignees: [{ login: 'gone', user: null }] });
      vi.mocked(prisma.event.findMany).mockResolvedValue([orphan] as never);

      await runReminderTick(now);

      expect(deliver).toHaveBeenCalledWith('eventReminder', expect.anything(), ['owner@x.fr']);
    });

    it('is not used when someone in charge can be written to', async () => {
      vi.mocked(prisma.event.findMany).mockResolvedValue([event()] as never);

      await runReminderTick(now);

      expect(emailsOfHolders).not.toHaveBeenCalled();
      expect(deliver).toHaveBeenCalledWith('eventReminder', expect.anything(), ['alice@x.fr']);
    });

    it('is not even looked up on a chat channel, which needs no recipient', async () => {
      setConfig({ channel: 'discord' });
      vi.mocked(prisma.event.findMany).mockResolvedValue([event({ assignees: [] })] as never);

      await runReminderTick(now);

      expect(emailsOfHolders).not.toHaveBeenCalled();
      expect(deliver).toHaveBeenCalledWith('eventReminder', expect.anything(), []);
    });
  });
});
