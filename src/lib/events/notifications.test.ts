import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn() }));
vi.mock('next-intl', () => ({ createTranslator: vi.fn(() => (key: string) => key) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { updateMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { notify } = await import('@/lib/notifications');
const { prisma } = await import('@/lib/prisma');
const { deliver, notifyEventConfirmed } = await import('./notifications');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { timezone: 'Europe/Paris', defaultLocale: 'fr' },
    notifications: { eventConfirmed: channel, eventReminder: channel },
    events: { categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }], reminderHour: 18 },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('deliver', () => {
  it('sends nothing when the channel is "none"', async () => {
    useChannel('none');
    await expect(deliver('eventConfirmed', message, ['a@x.fr'])).resolves.toEqual({
      sent: 0,
      failed: 0,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends one email per recipient', async () => {
    useChannel('email');
    await deliver('eventConfirmed', message, ['a@x.fr', 'b@x.fr']);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith('eventConfirmed', { ...message, to: 'a@x.fr' });
    expect(notify).toHaveBeenCalledWith('eventConfirmed', { ...message, to: 'b@x.fr' });
  });

  it('keeps notifying the other recipients when one email fails', async () => {
    useChannel('email');
    vi.mocked(notify)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('550 mailbox unavailable'))
      .mockResolvedValueOnce(undefined);

    const result = await deliver('eventConfirmed', message, ['a@x.fr', 'bad@x.fr', 'c@x.fr']);

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenLastCalledWith('eventConfirmed', { ...message, to: 'c@x.fr' });
  });

  it('does not throw when every email fails', async () => {
    useChannel('email');
    vi.mocked(notify).mockRejectedValue(new Error('SMTP down'));
    await expect(deliver('eventReminder', message, ['a@x.fr', 'b@x.fr'])).resolves.toEqual({
      sent: 0,
      failed: 2,
    });
  });

  it.each<Channel>(['discord', 'slack'])(
    'posts once to the %s channel, with no recipient',
    async (channel) => {
      useChannel(channel);
      await deliver('eventConfirmed', message, ['a@x.fr', 'b@x.fr']);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('eventConfirmed', message);
    },
  );

  it('does not throw when a webhook post fails', async () => {
    useChannel('discord');
    vi.mocked(notify).mockRejectedValue(new Error('webhook responded with 500'));
    await expect(deliver('eventConfirmed', message, [])).resolves.toEqual({ sent: 0, failed: 1 });
  });

  it('does not throw when the configuration cannot be read', async () => {
    vi.mocked(getConfig).mockImplementation(() => {
      throw new Error('config broken');
    });
    await expect(deliver('eventConfirmed', message, ['a@x.fr'])).resolves.toEqual({
      sent: 0,
      failed: 0,
    });
  });
});

describe('notifyEventConfirmed', () => {
  const storedEvent = {
    id: 'evt1',
    title: 'Tournoi',
    location: 'Gymnase',
    categoryKey: 'sport',
    status: 'CONFIRMED' as const,
    startsAt: new Date('2099-05-10T18:00:00Z'),
    endsAt: new Date('2099-05-10T20:00:00Z'),
    recurrence: 'NONE' as const,
    recurrenceUntil: null,
    assignees: [{ login: 'alice', user: { fullName: 'Alice A' } }],
  };

  beforeEach(() => {
    useChannel('email');
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(storedEvent as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { email: 'a@x.fr' },
      { email: 'b@x.fr' },
    ] as never);
  });

  it('claims the notification atomically, only for a confirmed event not yet notified', async () => {
    await notifyEventConfirmed('evt1');
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 'evt1', status: 'CONFIRMED', confirmationNotifiedAt: null },
      data: { confirmationNotifiedAt: expect.any(Date) },
    });
  });

  it('notifies every approved member by email', async () => {
    await notifyEventConfirmed('evt1');
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: { in: ['MEMBER', 'ADMIN', 'OWNER'] } },
      select: { email: true },
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when the event was already notified (claim lost)', async () => {
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 0 });
    await notifyEventConfirmed('evt1');
    expect(notify).not.toHaveBeenCalled();
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('never throws when the database fails', async () => {
    vi.mocked(prisma.event.findUnique).mockRejectedValue(new Error('db down'));
    await expect(notifyEventConfirmed('evt1')).resolves.toBeUndefined();
    vi.mocked(prisma.event.updateMany).mockRejectedValue(new Error('db down'));
    await expect(notifyEventConfirmed('evt1')).resolves.toBeUndefined();
  });

  it('never throws when every delivery fails', async () => {
    vi.mocked(notify).mockRejectedValue(new Error('SMTP down'));
    await expect(notifyEventConfirmed('evt1')).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
