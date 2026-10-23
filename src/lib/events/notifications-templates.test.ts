import { notificationsConfig } from '@/test/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The notifications of the proposal circuit with the templates of the BDE: what reaches the channels follows the template, in each of them,
 * with the variables of the event, and a template that cannot be used never costs the notification. The translator answers the key, so what
 * is checked is the template, not the words of the catalog.
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
    notificationTemplate: { findMany: vi.fn(), update: vi.fn() },
    notificationMention: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { notify, notifyMany } = await import('@/lib/notifications');
const { emailsOfHolders } = await import('@/lib/notifications/recipients');
const { prisma } = await import('@/lib/prisma');
const { notifyEventProposed, notifyEventRefused } = await import('./notifications');

const useChannels = (channels: Array<'discord' | 'slack' | 'email'>) =>
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', logoPath: '/logo.svg', timezone: 'Europe/Paris', defaultLocale: 'fr' },
    notifications: notificationsConfig({
      eventProposed: channels,
      eventApproved: 'none',
      eventRefused: channels,
    }),
    events: { categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }], reminderHour: 18 },
  } as unknown as ReturnType<typeof getConfig>);

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

const row = (type: string, scope: string, content: unknown) => ({
  type,
  scope,
  content,
  version: 1,
  basedOnRevision: 1,
  updatedAt: new Date(),
  updatedByLogin: 'paula',
  lastFallbackAt: null,
  lastFallbackReason: null,
});
const given = (rows: unknown[], mentions: unknown[] = []) => {
  vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue(rows as never);
  vi.mocked(prisma.notificationMention.findMany).mockResolvedValue(mentions as never);
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(notifyMany).mockImplementation(async (_event, messages) =>
    messages.map(() => ({ ok: true as const })),
  );
  vi.mocked(notify).mockResolvedValue(undefined as never);
  vi.mocked(emailsOfHolders).mockResolvedValue(['v1@x.fr']);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ fullName: 'Vera Validatrice' } as never);
  vi.mocked(prisma.notificationTemplate.update).mockResolvedValue({} as never);
  vi.mocked(prisma.event.findUnique).mockResolvedValue(stored as never);
  given([]);
});

const posted = (channel: 'discord' | 'slack') => {
  const call = vi.mocked(notify).mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`nothing was posted to ${channel}`);
  return call[1];
};
const emails = () => vi.mocked(notifyMany).mock.calls[0]?.[1] ?? [];

describe('a proposal, with the templates of the BDE', () => {
  it('writes the card of each channel as the template says, with the variables of the event', async () => {
    useChannels(['discord', 'slack', 'email']);
    given([
      row('eventProposed', 'all', {
        title: '{author} proposes {title}',
        footer: 'See {link}',
        items: {
          order: 'native',
          list: [
            { id: 'when', enabled: true },
            { id: 'where', enabled: true, label: 'Where?' },
            { id: 'proposedBy', enabled: true },
          ],
        },
      }),
      row('eventProposed', 'email', { subject: 'To validate: {title} ({category})' }),
    ]);
    await notifyEventProposed('evt1');

    expect(posted('discord').discord?.embeds[0]?.title).toBe('📝  Dave Pôle proposes Tournoi');
    expect(posted('discord').discord?.embeds[0]?.fields?.map((field) => field.name)).toEqual([
      expect.stringContaining('embed.fields.proposedBy'),
    ]);
    expect(JSON.stringify(posted('slack').slack?.blocks)).toContain('Dave Pôle proposes Tournoi');
    const [mail] = emails();
    expect(mail?.email?.subject).toBe('To validate: Tournoi (Sport)');
    expect(mail?.email?.html).toContain('>Dave Pôle proposes Tournoi</h1>');
    expect(mail?.email?.html).toContain('Where?');
    expect(mail?.email?.html).not.toContain('embed.fields.category');
  });

  it('puts a message above the card of the chats, with what the BDE mentions, never what an author wrote', async () => {
    useChannels(['discord', 'slack']);
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      ...stored,
      title: '@everyone <!channel> <@999>',
      author: { fullName: '@here', email: 'dave@x.fr' },
    } as never);
    given([
      row('eventProposed', 'discord', { above: '{@here} to validate: {title} by {author}' }),
      row('eventProposed', 'slack', { above: '{@channel} to validate: {title}' }),
    ]);
    await notifyEventProposed('evt1');

    const discordAbove = posted('discord').discord?.above;
    expect(discordAbove?.mentions).toEqual({ everyone: true, roles: [], users: [] });
    // the only @here is the one the template spells
    expect(discordAbove?.text.match(/@here/g)).toHaveLength(1);
    expect(discordAbove?.text).not.toContain('@everyone');
    expect(discordAbove?.text).not.toContain('<@999>');
    const slackAbove = posted('slack').slack?.above;
    expect(slackAbove?.startsWith('<!channel> ')).toBe(true);
    expect(slackAbove?.match(/<!channel>/g)).toHaveLength(1);
    expect(slackAbove).not.toContain('<@999>');
  });

  it('sends the platform’s own, and still tells everybody, when the template cannot be used', async () => {
    useChannels(['discord', 'email']);
    given([row('eventProposed', 'all', { title: '{reviewer}' })]);
    await notifyEventProposed('evt1');
    expect(posted('discord').discord?.embeds[0]?.title).toBe('📝  Tournoi');
    expect(emails()).toHaveLength(1);
  });
});

describe('a refusal, with the templates of the BDE', () => {
  it('shows the reason under the label the BDE chose, and the comment of the validator in its variable', async () => {
    useChannels(['discord', 'email']);
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      ...stored,
      status: 'DRAFT',
      refusalComment: 'Pendant les examens.',
    } as never);
    given([
      row('eventRefused', 'all', {
        title: 'Refused: {comment}',
        items: {
          order: 'native',
          list: [
            { id: 'reason', enabled: true, label: 'Why' },
            { id: 'when', enabled: true },
          ],
        },
      }),
    ]);
    await notifyEventRefused('evt1', 'vera');

    const card = posted('discord').discord?.embeds[0];
    expect(card?.title).toBe('⛔  Refused: Pendant les examens.');
    expect(card?.description).toContain('### 💬  Why');
    expect(card?.description).toContain('> Pendant les examens.');
    expect(emails()[0]?.email?.text).toContain('Why :\nPendant les examens.');
  });
});
