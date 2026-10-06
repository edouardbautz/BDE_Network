import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), notifyMany: vi.fn() }));
vi.mock('@/lib/notifications/sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Test' })),
}));
vi.mock('next-intl', () => ({ createTranslator: vi.fn(() => (key: string) => key) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { updateMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { notify, notifyMany } = await import('@/lib/notifications');
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
  // By default every email goes through.
  vi.mocked(notifyMany).mockImplementation(async (_event, messages) =>
    messages.map(() => ({ ok: true as const })),
  );
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

  it('sends one email per recipient, all in one batch', async () => {
    useChannel('email');
    await deliver('eventConfirmed', message, ['a@x.fr', 'b@x.fr']);

    expect(notifyMany).toHaveBeenCalledExactlyOnceWith('eventConfirmed', [
      { ...message, to: 'a@x.fr' },
      { ...message, to: 'b@x.fr' },
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('counts, and logs, the recipients whose email failed, without stopping the others', async () => {
    useChannel('email');
    vi.mocked(notifyMany).mockResolvedValue([
      { ok: true },
      { ok: false, error: new Error('550 mailbox unavailable') },
      { ok: true },
    ]);

    const result = await deliver('eventConfirmed', message, ['a@x.fr', 'bad@x.fr', 'c@x.fr']);

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('does not throw when every email fails', async () => {
    useChannel('email');
    vi.mocked(notifyMany).mockResolvedValue([
      { ok: false, error: new Error('SMTP down') },
      { ok: false, error: new Error('SMTP down') },
    ]);
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
    expect(notifyMany).not.toHaveBeenCalled();
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
    description: 'Venez nombreux.',
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
      where: { status: { in: ['MEMBER', 'OWNER'] } },
      select: { email: true },
    });
    expect(notifyMany).toHaveBeenCalledWith('eventConfirmed', [
      expect.objectContaining({ to: 'a@x.fr' }),
      expect.objectContaining({ to: 'b@x.fr' }),
    ]);
  });

  it('on Discord, posts a card in the colour of the event category, with its facts', async () => {
    useChannel('discord');
    await notifyEventConfirmed('evt1');

    const [, posted] = vi.mocked(notify).mock.calls[0] ?? [];
    const [embed] = posted?.discord?.embeds ?? [];
    expect(posted?.discord?.username).toBe('BDE Test');
    expect(embed?.title).toBe('Tournoi');
    expect(embed?.color).toBe(0x16a34a); // the colour of "sport" in the config
    expect(embed?.description).toContain('Venez nombreux.');
    expect(embed?.description).toContain('embed.kind.confirmed'); // not a reminder's heading
    expect(embed?.fields?.map((field) => field.value)).toEqual(
      expect.arrayContaining(['Gymnase', 'Sport', 'Alice A']),
    );
  });

  it('decides on the channel of eventConfirmed, not of the reminder', async () => {
    vi.mocked(getConfig).mockReturnValue({
      bde: { timezone: 'Europe/Paris', defaultLocale: 'fr' },
      notifications: { eventConfirmed: 'discord', eventReminder: 'email' },
      events: {
        categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }],
        reminderHour: 18,
      },
    } as unknown as ReturnType<typeof getConfig>);
    await notifyEventConfirmed('evt1');

    expect(vi.mocked(notify).mock.calls[0]?.[1].discord).toBeDefined();
  });

  it('keeps the plain text next to the card, and sends no card by email', async () => {
    useChannel('discord');
    await notifyEventConfirmed('evt1');
    expect(vi.mocked(notify).mock.calls[0]?.[1].subject).toBeTruthy();

    vi.clearAllMocks();
    useChannel('email');
    await notifyEventConfirmed('evt1');
    const [first] = vi.mocked(notifyMany).mock.calls[0]?.[1] ?? [];
    expect(first).not.toHaveProperty('discord');
  });

  it('sends nothing when the event was already notified (claim lost)', async () => {
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 0 });
    await notifyEventConfirmed('evt1');
    expect(notifyMany).not.toHaveBeenCalled();
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('never throws when the database fails', async () => {
    vi.mocked(prisma.event.findUnique).mockRejectedValue(new Error('db down'));
    await expect(notifyEventConfirmed('evt1')).resolves.toBeUndefined();
    vi.mocked(prisma.event.updateMany).mockRejectedValue(new Error('db down'));
    await expect(notifyEventConfirmed('evt1')).resolves.toBeUndefined();
  });

  it('never throws when every delivery fails', async () => {
    vi.mocked(notifyMany).mockRejectedValue(new Error('SMTP down'));
    await expect(notifyEventConfirmed('evt1')).resolves.toBeUndefined();
    expect(notifyMany).toHaveBeenCalledTimes(1);
  });
});
