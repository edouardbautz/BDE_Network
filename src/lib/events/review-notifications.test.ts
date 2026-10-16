import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the proposal circuit tells, and to whom: the validators that an event waits for them, the author that it was
 * approved or refused (with the comment). The translator is a double that answers the key, so the texts below are the
 * message keys; what is checked is who receives what, on which channel, and that a stale notice is never sent.
 */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), notifyMany: vi.fn() }));
vi.mock('@/lib/notifications/recipients', () => ({ emailsOfHolders: vi.fn() }));
vi.mock('@/lib/public-address', () => ({ registeredAddress: () => 'https://bde.example' }));
vi.mock('@/lib/notifications/sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Test' })),
  resolveLogoUrl: vi.fn(async () => undefined),
}));
vi.mock('next-intl', () => ({ createTranslator: vi.fn(() => (key: string) => key) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { notify, notifyMany } = await import('@/lib/notifications');
const { emailsOfHolders } = await import('@/lib/notifications/recipients');
const { prisma } = await import('@/lib/prisma');
const { notifyEventApproved, notifyEventProposed, notifyEventRefused } =
  await import('./notifications');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannels(channels: Partial<Record<'proposed' | 'approved' | 'refused', Channel>>) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', logoPath: '/logo.svg', timezone: 'Europe/Paris', defaultLocale: 'fr' },
    notifications: {
      eventProposed: channels.proposed ?? 'none',
      eventApproved: channels.approved ?? 'none',
      eventRefused: channels.refused ?? 'none',
    },
    events: { categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }], reminderHour: 18 },
  } as unknown as ReturnType<typeof getConfig>);
}

const stored = {
  id: 'evt1',
  title: 'Tournoi',
  description: 'Venez nombreux.',
  updatedAt: new Date('2099-01-01T00:00:00Z'),
  cancellations: [],
  occurrences: [],
  location: 'Gymnase',
  categoryKey: 'sport',
  status: 'PROPOSED' as const,
  startsAt: new Date('2099-05-10T18:00:00Z'),
  endsAt: new Date('2099-05-10T20:00:00Z'),
  repeat: null,
  recurrenceUntil: null,
  assignees: [{ login: 'alice', user: { fullName: 'Alice A' } }],
  authorLogin: 'dave',
  author: { fullName: 'Dave Pôle', email: 'dave@x.fr' },
  refusalComment: null as string | null,
};

const found = (overrides: Record<string, unknown> = {}) =>
  vi.mocked(prisma.event.findUnique).mockResolvedValue({ ...stored, ...overrides } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(notifyMany).mockImplementation(async (_event, messages) =>
    messages.map(() => ({ ok: true as const })),
  );
  vi.mocked(emailsOfHolders).mockResolvedValue(['v1@x.fr', 'v2@x.fr']);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ fullName: 'Vera Validatrice' } as never);
  found();
});

const emails = () => vi.mocked(notifyMany).mock.calls[0]?.[1] ?? [];
const embed = () => vi.mocked(notify).mock.calls[0]?.[1].discord?.embeds[0];

describe('a proposal (eventProposed)', () => {
  it('does nothing, and reads nothing, when the notification is off', async () => {
    useChannels({ proposed: 'none' });
    await notifyEventProposed('evt1');

    expect(prisma.event.findUnique).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(notifyMany).not.toHaveBeenCalled();
  });

  it('tells, by e-mail, everybody who can validate events, each with the designed message', async () => {
    useChannels({ proposed: 'email' });
    await notifyEventProposed('evt1');

    expect(emailsOfHolders).toHaveBeenCalledExactlyOnceWith('events.validate');
    expect(emails().map((message) => message.to)).toEqual(['v1@x.fr', 'v2@x.fr']);
    for (const message of emails()) {
      expect(message.subject).toBe('proposed.subject');
      expect(message.email?.html).toContain('>Tournoi</h1>');
      expect(message.email?.html).toContain('Dave Pôle'); // who proposed it
      expect(message.email?.html).toContain('email.reviewAction'); // the button asks to examine it
      expect(message).not.toHaveProperty('discord');
    }
  });

  it('puts no calendar file in it: the event is not published', async () => {
    useChannels({ proposed: 'email' });
    await notifyEventProposed('evt1');
    expect(emails()[0]?.email).not.toHaveProperty('ics');
  });

  it('posts one card in the channel of a chat, naming the author, and looks up nobody by e-mail', async () => {
    useChannels({ proposed: 'discord' });
    await notifyEventProposed('evt1');

    expect(emailsOfHolders).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(embed()?.title).toBe('📝  Tournoi');
    expect(embed()?.color).toBe(0x16a34a);
    expect(embed()?.description).toContain('EMBED.KIND.PROPOSED');
    expect(embed()?.fields?.map((field) => field.value)).toEqual(['Sport', 'Dave Pôle', 'Alice A']);
  });

  it('posts a Slack message that links to the examination of the proposal', async () => {
    useChannels({ proposed: 'slack' });
    await notifyEventProposed('evt1');

    const slack = vi.mocked(notify).mock.calls[0]?.[1].slack;
    expect(JSON.stringify(slack)).toContain('Dave Pôle');
    expect(JSON.stringify(slack)).toContain('slack.reviewAction');
  });

  it.each(['DRAFT', 'CONFIRMED'])(
    'says nothing when the event is no longer a proposal (it is %s: somebody answered, or it was withdrawn)',
    async (status) => {
      useChannels({ proposed: 'email' });
      found({ status });
      await notifyEventProposed('evt1');

      expect(notifyMany).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it('says nothing about an event that is gone', async () => {
    useChannels({ proposed: 'email' });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    await notifyEventProposed('evt1');
    expect(notifyMany).not.toHaveBeenCalled();
  });

  it('names the login when the account of the author is gone', async () => {
    useChannels({ proposed: 'discord' });
    found({ author: null });
    await notifyEventProposed('evt1');
    expect(embed()?.fields?.map((field) => field.value)).toContain('dave');
  });

  it('never throws, and logs, when something fails', async () => {
    useChannels({ proposed: 'email' });
    vi.mocked(prisma.event.findUnique).mockRejectedValue(new Error('database down'));
    await expect(notifyEventProposed('evt1')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('an approval (eventApproved)', () => {
  beforeEach(() => found({ status: 'CONFIRMED' }));

  it('tells the author, and only the author, by e-mail', async () => {
    useChannels({ approved: 'email' });
    await notifyEventApproved('evt1', 'vera');

    expect(emailsOfHolders).not.toHaveBeenCalled();
    expect(emails().map((message) => message.to)).toEqual(['dave@x.fr']);
    expect(emails()[0]?.subject).toBe('approved.subject');
    expect(emails()[0]?.email?.html).toContain('Vera Validatrice'); // who approved it
  });

  it('does not tell a validator that they approved their own event', async () => {
    useChannels({ approved: 'email' });
    await notifyEventApproved('evt1', 'dave');
    expect(emails()).toEqual([]);
  });

  it('tells nobody when the author has no account any more', async () => {
    useChannels({ approved: 'email' });
    found({ status: 'CONFIRMED', author: null });
    await notifyEventApproved('evt1', 'vera');
    expect(emails()).toEqual([]);
  });

  it('is one team card on a chat channel, naming the author and who approved', async () => {
    useChannels({ approved: 'discord' });
    await notifyEventApproved('evt1', 'vera');

    expect(embed()?.title).toBe('✅  Tournoi');
    expect(embed()?.fields?.map((field) => field.value)).toEqual([
      'Sport',
      'Dave Pôle',
      'Vera Validatrice',
      'Alice A',
    ]);
  });

  it('says nothing about an event that is not published after all', async () => {
    useChannels({ approved: 'email' });
    found({ status: 'DRAFT' });
    await notifyEventApproved('evt1', 'vera');
    expect(notifyMany).not.toHaveBeenCalled();
  });

  it('shows a date approved on its own, when the rest of the series is still a proposal', async () => {
    useChannels({ approved: 'discord' });
    found({
      status: 'PROPOSED',
      repeat: { freq: 'WEEKLY', interval: 1 },
      recurrenceUntil: new Date('2099-05-31T18:00:00Z'),
      occurrences: [
        {
          occurrenceStart: new Date('2099-05-17T18:00:00Z'),
          title: null,
          description: null,
          location: null,
          categoryKey: null,
          status: 'CONFIRMED',
          startsAt: null,
          endsAt: null,
          assigneesOverridden: false,
          confirmationNotifiedAt: null,
          updatedAt: new Date('2099-01-01T00:00:00Z'),
          assignees: [],
        },
      ],
    });
    await notifyEventApproved('evt1', 'vera');

    expect(notify).toHaveBeenCalledTimes(1);
    // 17 May 2099, 18:00 UTC: the date that was approved, not the first one of the series
    const seventeenth = new Date('2099-05-17T18:00:00Z').getTime() / 1000;
    expect(embed()?.description).toContain(`<t:${seventeenth}:F>`);
  });
});

describe('a refusal (eventRefused)', () => {
  const comment = 'Cette date tombe pendant les examens.';
  beforeEach(() => found({ status: 'DRAFT', refusalComment: comment }));

  it('tells the author by e-mail, with the comment of the validator', async () => {
    useChannels({ refused: 'email' });
    await notifyEventRefused('evt1', 'vera');

    expect(emails().map((message) => message.to)).toEqual(['dave@x.fr']);
    expect(emails()[0]?.subject).toBe('refused.subject');
    expect(emails()[0]?.email?.html).toContain(comment);
    expect(emails()[0]?.email?.text).toContain(comment);
    expect(emails()[0]?.body).toContain(comment); // the plain message, for every other channel
  });

  it('puts the comment first in the card of a chat, as a quote, under a heading of its own', async () => {
    useChannels({ refused: 'discord' });
    await notifyEventRefused('evt1', 'vera');

    expect(embed()?.title).toBe('⛔  Tournoi');
    const description = embed()?.description ?? '';
    expect(description).toContain(`> ${comment}`);
    expect(description.indexOf(comment)).toBeLessThan(description.indexOf('Gymnase'));
    expect(embed()?.fields?.map((field) => field.value)).toContain('Vera Validatrice');
  });

  it('keeps every line of the comment in its quote, so none of them becomes a heading', async () => {
    useChannels({ refused: 'discord' });
    found({ status: 'DRAFT', refusalComment: 'Première ligne\n### Faux titre' });
    await notifyEventRefused('evt1', 'vera');

    expect(embed()?.description).toContain('> Première ligne\n> ### Faux titre');
  });

  it('puts the comment in the Slack message', async () => {
    useChannels({ refused: 'slack' });
    await notifyEventRefused('evt1', 'vera');
    expect(JSON.stringify(vi.mocked(notify).mock.calls[0]?.[1].slack)).toContain(comment);
  });

  it.each([
    ['proposed again since', { status: 'PROPOSED', refusalComment: null }],
    ['approved since', { status: 'CONFIRMED', refusalComment: null }],
    ['a draft that carries no refusal', { status: 'DRAFT', refusalComment: null }],
  ])('says nothing about an event %s: the notice would be stale', async (_label, change) => {
    useChannels({ refused: 'email' });
    found(change);
    await notifyEventRefused('evt1', 'vera');
    expect(notifyMany).not.toHaveBeenCalled();
  });

  it('is told apart per notification: a refusal does not follow the channel of the approval', async () => {
    useChannels({ approved: 'discord', refused: 'email' });
    await notifyEventRefused('evt1', 'vera');
    expect(notifyMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
