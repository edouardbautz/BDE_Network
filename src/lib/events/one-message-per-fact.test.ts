import { notificationsConfig } from '@/test/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One message per fact. Validating a proposal is ONE fact: the room (Discord, Slack) gets the announcement of the event, once, and it says
 * who proposed it and who validated it; the answer to the proposal (`eventApproved`) is personal, an e-mail to the author, and the refusal
 * (`eventRefused`) likewise. These tests play the two senders of a validation, the way the action does, and count what each channel
 * receives. They fail on the code that posted "Proposal validated" and "New event confirmed" side by side.
 */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), notifyMany: vi.fn() }));
vi.mock('@/lib/notifications/recipients', () => ({ emailsOfHolders: vi.fn() }));
vi.mock('@/lib/public-address', () => ({ registeredAddress: () => 'https://bde.example' }));
vi.mock('@/lib/notifications/sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Test' })),
  resolveLogoUrl: vi.fn(async () => undefined),
}));
vi.mock('next-intl', () => ({
  createTranslator: vi.fn(() => (key: string) => key),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    notificationTemplate: { findMany: vi.fn(), update: vi.fn() },
    notificationMention: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { notify, notifyMany } = await import('@/lib/notifications');
const { emailsOfHolders } = await import('@/lib/notifications/recipients');
const { prisma } = await import('@/lib/prisma');
const { notifyEventApproved, notifyEventConfirmed, notifyEventRefused } =
  await import('./notifications');

type Channel = 'discord' | 'slack' | 'email';

/** What a BDE of an older version may have saved: the chat channels ticked for the answers, too. */
function useChannels(options: { confirmed: Channel[]; approved: Channel[]; refused?: Channel[] }) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', logoPath: '/logo.svg', timezone: 'Europe/Paris', defaultLocale: 'fr' },
    notifications: notificationsConfig({
      eventConfirmed: options.confirmed,
      eventApproved: options.approved,
      eventRefused: options.refused ?? [],
    }),
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
  status: 'CONFIRMED' as const,
  startsAt: new Date('2099-05-10T18:00:00Z'),
  endsAt: new Date('2099-05-10T20:00:00Z'),
  repeat: null,
  recurrenceUntil: null,
  assignees: [{ login: 'alice', user: { fullName: 'Alice A' } }],
  authorLogin: 'dave',
  author: { fullName: 'Dave Pôle', email: 'dave@x.fr' },
  proposedAt: new Date('2099-01-01T00:00:00Z') as Date | null,
  refusalComment: null as string | null,
};

const AUTHOR_DISCORD = '348291047563210241';
const MEMBERS = [{ email: 'dave@x.fr' }, { email: 'eve@x.fr' }];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(notifyMany).mockImplementation(async (_event, messages) =>
    messages.map(() => ({ ok: true as const })),
  );
  vi.mocked(notify).mockResolvedValue(undefined as never);
  vi.mocked(emailsOfHolders).mockResolvedValue([]);
  vi.mocked(prisma.event.findUnique).mockResolvedValue(stored as never);
  vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue([]);
  vi.mocked(prisma.notificationMention.findMany).mockResolvedValue([]);
  vi.mocked(prisma.notificationTemplate.update).mockResolvedValue({} as never);
  // a lookup by login: the names of the people, and the ids the author gave on their profile
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: {
    where: { login: string };
  }) =>
    args.where.login === 'dave'
      ? {
          fullName: 'Dave Pôle',
          discordUserId: AUTHOR_DISCORD,
          slackUserId: 'U04ABCD1234',
        }
      : { fullName: 'Vera Validatrice', discordUserId: null, slackUserId: null }) as never);
  // the approved members, as the database answers: the query may leave one login out
  vi.mocked(prisma.user.findMany).mockImplementation((async (args?: {
    where?: { login?: { not?: string } };
  }) => MEMBERS.filter((member) => member.email !== `${args?.where?.login?.not}@x.fr`)) as never);
});

/** Validating a proposal, as `announceStatusChange` does it: the announcement of the event and the answer to the author. */
async function validate(actor = 'vera') {
  await notifyEventConfirmed('evt1', { reviewerLogin: actor });
  await notifyEventApproved('evt1', actor);
}

const chatPosts = () =>
  vi.mocked(notify).mock.calls.filter(([channel]) => channel === 'discord' || channel === 'slack');
const emailsSent = () => vi.mocked(notifyMany).mock.calls.flatMap(([, messages]) => messages);

describe('validating a proposal', () => {
  it.each([
    ['Discord', ['discord']],
    ['Slack', ['slack']],
    ['both', ['discord', 'slack']],
  ] as const)(
    'posts ONE message in the room (%s), even when an older configuration ticks the chat for the answer too',
    async (_label, chat) => {
      useChannels({ confirmed: [...chat], approved: [...chat, 'email'] });
      await validate();

      // one message per chat channel, and it is the announcement of the event
      expect(chatPosts()).toHaveLength(chat.length);
      expect(chatPosts().map(([channel]) => channel)).toEqual([...chat]);
    },
  );

  it('says in that message who proposed the event and who validated it', async () => {
    useChannels({ confirmed: ['discord', 'slack'], approved: ['discord', 'slack'] });
    await validate();

    const discord = vi.mocked(notify).mock.calls.find(([channel]) => channel === 'discord')?.[1];
    const fields = discord?.discord?.embeds[0]?.fields?.map((field) => field.value);
    expect(fields).toEqual(expect.arrayContaining(['Dave Pôle', 'Vera Validatrice']));
    expect(discord?.discord?.embeds[0]?.title).toContain('Tournoi');
    const slack = vi.mocked(notify).mock.calls.find(([channel]) => channel === 'slack')?.[1];
    expect(JSON.stringify(slack?.slack)).toContain('Dave Pôle');
    expect(JSON.stringify(slack?.slack)).toContain('Vera Validatrice');
  });

  it('writes to the author ONCE by e-mail: the personal answer, not also the announcement to every member', async () => {
    useChannels({ confirmed: ['email'], approved: ['email'] });
    await validate();

    const recipients = emailsSent().map((message) => message.to);
    expect(recipients.filter((to) => to === 'dave@x.fr')).toHaveLength(1);
    // the other members still get the announcement
    expect(recipients).toContain('eve@x.fr');
    expect(emailsSent().find((message) => message.to === 'dave@x.fr')?.subject).toBe(
      'approved.subject',
    );
    // and the announcement does not go to the author (the query leaves them out)
    expect(vi.mocked(prisma.user.findMany).mock.calls[0]?.[0]).toMatchObject({
      where: { login: { not: 'dave' } },
    });
  });

  it('writes to the author in the announcement when the answer is not sent by e-mail', async () => {
    useChannels({ confirmed: ['email'], approved: [] });
    await validate();
    expect(vi.mocked(prisma.user.findMany).mock.calls[0]?.[0]).not.toHaveProperty('where.login');
    expect(emailsSent().map((message) => message.to)).toEqual(['dave@x.fr', 'eve@x.fr']);
  });

  it('counts the messages of the fact: 1 per chat channel and 1 per person, never two for the same one', async () => {
    useChannels({
      confirmed: ['discord', 'slack', 'email'],
      approved: ['discord', 'slack', 'email'],
    });
    await validate();
    expect(chatPosts()).toHaveLength(2);
    const perPerson = new Map<string, number>();
    for (const { to } of emailsSent())
      perPerson.set(String(to), (perPerson.get(String(to)) ?? 0) + 1);
    expect([...perPerson.values()].every((count) => count === 1)).toBe(true);
    expect(perPerson.size).toBe(2);
  });

  it('tells nobody twice when the validator is the author: nothing personal to send, the announcement carries both names', async () => {
    useChannels({ confirmed: ['email', 'discord'], approved: ['email'] });
    await validate('dave');

    const mails = emailsSent().map((message) => message.to);
    expect(mails.filter((to) => to === 'dave@x.fr')).toHaveLength(1); // as a member, by the announcement
    expect(chatPosts()).toHaveLength(1);
    expect(chatPosts()[0]?.[1].discord?.above).toBeUndefined(); // nobody to mention: they did it themselves
  });
});

describe('an event that did not come from a proposal', () => {
  it('is announced as it has always been: no proposer, no validator, no mention', async () => {
    useChannels({ confirmed: ['discord'], approved: [] });
    vi.mocked(prisma.event.findUnique).mockResolvedValue({ ...stored, proposedAt: null } as never);
    await notifyEventConfirmed('evt1', { reviewerLogin: 'vera' });
    await notifyEventConfirmed('evt1');

    for (const [, message] of chatPosts()) {
      expect(message.discord?.above).toBeUndefined();
      const fields = message.discord?.embeds[0]?.fields?.map((field) => field.value) ?? [];
      expect(fields).not.toContain('Dave Pôle');
      expect(fields).not.toContain('Vera Validatrice');
    }
  });
});

describe('{@author} in the announcement of a proposal', () => {
  const above = () =>
    vi.mocked(notify).mock.calls.find(([channel]) => channel === 'discord')?.[1].discord?.above;

  it('by default pings the author, and only the author, by the id of their profile', async () => {
    useChannels({ confirmed: ['discord'], approved: [] });
    await notifyEventConfirmed('evt1', { reviewerLogin: 'vera' });

    expect(above()?.text).toBe(`<@${AUTHOR_DISCORD}> authorValidated`);
    expect(above()?.mentions).toEqual({ everyone: false, roles: [], users: [AUTHOR_DISCORD] });
  });

  it('pings nobody, and writes nothing above the card, when the author gave no id', async () => {
    useChannels({ confirmed: ['discord'], approved: [] });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      fullName: 'Dave Pôle',
      discordUserId: null,
      slackUserId: null,
    } as never);
    await notifyEventConfirmed('evt1', { reviewerLogin: 'vera' });
    expect(above()).toBeUndefined();
  });

  it('changes nothing for a BDE that already customised the template of the announcement', async () => {
    useChannels({ confirmed: ['discord'], approved: [] });
    vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue([
      {
        type: 'eventConfirmed',
        scope: 'discord',
        content: { title: '{title}!' },
        version: 1,
        basedOnRevision: 1,
        updatedAt: new Date(),
        updatedByLogin: 'paula',
        lastFallbackAt: null,
        lastFallbackReason: null,
      },
    ] as never);
    await notifyEventConfirmed('evt1', { reviewerLogin: 'vera' });
    expect(above()).toBeUndefined();
  });

  it('is what the BDE writes, when it writes it: the template wins over the default', async () => {
    useChannels({ confirmed: ['discord'], approved: [] });
    vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue([
      {
        type: 'eventConfirmed',
        scope: 'discord',
        content: { above: 'Bravo {@author} ! {@everyone}' },
        version: 1,
        basedOnRevision: 2,
        updatedAt: new Date(),
        updatedByLogin: 'paula',
        lastFallbackAt: null,
        lastFallbackReason: null,
      },
    ] as never);
    await notifyEventConfirmed('evt1', { reviewerLogin: 'vera' });
    expect(above()?.text).toBe(`Bravo <@${AUTHOR_DISCORD}> ! @everyone`);
  });

  it('is nobody in the announcement of an event that did not come from a proposal', async () => {
    useChannels({ confirmed: ['discord'], approved: [] });
    vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue([
      {
        type: 'eventConfirmed',
        scope: 'discord',
        content: { above: 'Hello {@author}' },
        version: 1,
        basedOnRevision: 2,
        updatedAt: new Date(),
        updatedByLogin: 'paula',
        lastFallbackAt: null,
        lastFallbackReason: null,
      },
    ] as never);
    await notifyEventConfirmed('evt1'); // confirmed by a validator from a draft: no proposal
    expect(above()?.text).toBe('Hello');
    expect(above()?.mentions.users).toEqual([]);
  });
});

describe('a refusal', () => {
  const refused = { ...stored, status: 'DRAFT' as const, refusalComment: 'Pendant les examens.' };

  it('is one e-mail to the author, and nothing in the room', async () => {
    useChannels({ confirmed: ['discord'], approved: [], refused: ['discord', 'slack', 'email'] });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(refused as never);
    await notifyEventRefused('evt1', 'vera');

    expect(chatPosts()).toHaveLength(0);
    expect(emailsSent().map((message) => message.to)).toEqual(['dave@x.fr']);
  });
});
