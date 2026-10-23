import { notificationsConfig } from '@/test/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A whole send of the notifications about members, with templates written by the BDE: what reaches `deliver` follows the template,
 * the mentions are the BDE's and nobody else's, and a template that cannot be used never costs the notification.
 */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications/deliver', () => ({
  deliver: vi.fn(async () => ({ sent: 1, failed: 0 })),
}));
vi.mock('@/lib/notifications/translate', () => ({
  /** The real French catalog, so a missing message fails the test. */
  getNotificationTranslate: vi.fn(async (_locale: string, namespace: string) => {
    const messages = (await import('../../../messages/fr.json')).default as Record<string, unknown>;
    const node = namespace
      .split('.')
      .reduce<unknown>((n, part) => (n as Record<string, unknown>)[part], messages);
    return (key: string, values: Record<string, string | number> = {}) => {
      const text = key
        .split('.')
        .reduce<unknown>((n, part) => (n as Record<string, unknown>)?.[part], node);
      if (typeof text !== 'string') throw new Error(`missing message ${namespace}.${key}`);
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    };
  }),
}));
vi.mock('@/lib/notifications/sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Test' })),
  resolveLogoUrl: vi.fn(async () => undefined),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    notificationTemplate: { findMany: vi.fn(), update: vi.fn() },
    notificationMention: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { deliver } = await import('@/lib/notifications/deliver');
const { prisma } = await import('@/lib/prisma');
const { notifyMemberApproved, notifyMemberPending, notifyMemberRemoved } =
  await import('./notifications');

type Channels = Array<'discord' | 'slack' | 'email'>;

function useChannels(
  channels: Partial<Record<'memberPending' | 'memberApproved' | 'memberRemoved', Channels>>,
) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', defaultLocale: 'fr' },
    notifications: notificationsConfig({
      memberPending: 'none',
      memberApproved: 'none',
      memberRemoved: 'none',
      ...channels,
    }),
  } as unknown as ReturnType<typeof getConfig>);
}

const delivered = () => {
  const call = vi.mocked(deliver).mock.calls[0];
  if (!call) throw new Error('never delivered');
  return call[1];
};

const pendingUser = {
  login: 'jdupont',
  fullName: 'Jean Dupont',
  campus: 'Nice',
  status: 'PENDING',
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
const bureau = {
  id: '1',
  key: 'bureau',
  platform: 'discord',
  kind: 'role',
  label: 'Bureau',
  externalId: '123456789012345678',
  createdByLogin: 'paula',
  createdAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(deliver).mockResolvedValue({ sent: 1, failed: 0 } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue(pendingUser as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ email: 'paula@example.fr' }] as never);
  vi.mocked(prisma.notificationTemplate.update).mockResolvedValue({} as never);
  given([]);
});

describe('a request for access, with the templates of the BDE', () => {
  it('is sent as it has always been when the BDE wrote nothing', async () => {
    useChannels({ memberPending: ['discord', 'slack', 'email'] });
    await notifyMemberPending('u1');
    const message = delivered();
    expect(message.discord?.embeds[0]?.title).toBe('🙋  Jean Dupont');
    expect(message.discord?.above).toBeUndefined();
    expect(message.slack?.above).toBeUndefined();
    expect(message.email?.subject).toBeUndefined();
  });

  it('follows the template written for all channels, in each of them', async () => {
    useChannels({ memberPending: ['discord', 'slack', 'email'] });
    given([row('memberPending', 'all', { title: 'Hello {name} from {campus}', footer: 'Mine' })]);
    await notifyMemberPending('u1');
    const message = delivered();
    expect(message.discord?.embeds[0]?.title).toBe('🙋  Hello Jean Dupont from Nice');
    expect(message.discord?.embeds[0]?.footer?.text).toBe('Mine');
    expect(JSON.stringify(message.slack?.blocks)).toContain('Hello Jean Dupont from Nice');
    expect(message.email?.html).toContain('>Hello Jean Dupont from Nice</h1>');
  });

  it('lets a channel differ from the others, and sets the subject of the e-mail', async () => {
    useChannels({ memberPending: ['discord', 'email'] });
    given([
      row('memberPending', 'all', { title: 'Shared' }),
      row('memberPending', 'email', { title: 'For the mailbox', subject: 'Request from {name}' }),
    ]);
    await notifyMemberPending('u1');
    const message = delivered();
    expect(message.discord?.embeds[0]?.title).toBe('🙋  Shared');
    expect(message.email?.html).toContain('>For the mailbox</h1>');
    expect(message.email?.subject).toBe('Request from Jean Dupont');
  });

  it('puts the message above the card, with the mentions of the BDE and only those', async () => {
    useChannels({ memberPending: ['discord', 'slack'] });
    given(
      [
        row('memberPending', 'discord', { above: '{@role:bureau} {@here} new request: {name}' }),
        row('memberPending', 'slack', { above: '{@channel} {name}' }),
      ],
      [bureau],
    );
    await notifyMemberPending('u1');
    const message = delivered();
    expect(message.discord?.above?.text).toBe(
      '<@&123456789012345678> @here new request: Jean Dupont',
    );
    expect(message.discord?.above?.mentions).toEqual({
      everyone: true,
      roles: ['123456789012345678'],
      users: [],
    });
    expect(message.slack?.above).toBe('<!channel> Jean Dupont');
  });

  it('never lets what a member is called ping anybody, in the message above or anywhere else', async () => {
    useChannels({ memberPending: ['discord', 'slack'] });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...pendingUser,
      fullName: '@everyone <@123> <!channel>',
    } as never);
    given([
      row('memberPending', 'discord', { above: 'New: {name}' }),
      row('memberPending', 'slack', { above: 'New: {name}', title: '{name}' }),
    ]);
    await notifyMemberPending('u1');
    const message = delivered();
    expect(message.discord?.above?.mentions).toEqual({ everyone: false, roles: [], users: [] });
    expect(message.discord?.above?.text).not.toContain('@everyone');
    expect(message.discord?.above?.text).not.toContain('<@123>');
    expect(message.slack?.above).not.toContain('<!channel>');
  });

  it('sends the platform’s own when the template is not valid, and still delivers', async () => {
    useChannels({ memberPending: ['discord'] });
    given([row('memberPending', 'all', { title: '{nobody_has_this}' })]);
    await notifyMemberPending('u1');
    expect(delivered().discord?.embeds[0]?.title).toBe('🙋  Jean Dupont');
  });

  it('sends the platform’s own when a mention the template relies on was deleted', async () => {
    useChannels({ memberPending: ['discord'] });
    given([row('memberPending', 'discord', { above: '{@role:gone} hi' })], []);
    await notifyMemberPending('u1');
    expect(delivered().discord?.above).toBeUndefined();
  });

  it('delivers the platform’s own when the templates cannot be read', async () => {
    useChannels({ memberPending: ['discord'] });
    vi.mocked(prisma.notificationTemplate.findMany).mockRejectedValue(new Error('db down'));
    await notifyMemberPending('u1');
    expect(delivered().discord?.embeds[0]?.title).toBe('🙋  Jean Dupont');
  });
});

describe('an approval and a removal, with the templates of the BDE', () => {
  it('applies the template of an approval to the team’s card and not to the e-mail of the member', async () => {
    useChannels({ memberApproved: ['discord', 'email'] });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      login: 'jdupont',
      fullName: 'Jean Dupont',
      campus: 'Nice',
      email: 'jean@example.fr',
      status: 'MEMBER',
      role: { name: 'Trésorier' },
    } as never);
    given([row('memberApproved', 'all', { title: 'Welcome {name}', footer: 'Team footer' })]);
    await notifyMemberApproved('u1', 'pmartin');
    const message = delivered();
    expect(message.discord?.embeds[0]?.title).toBe('✅  Welcome Jean Dupont');
    expect(message.email?.html).not.toContain('Welcome Jean Dupont');
    expect(message.email?.html).not.toContain('Team footer');
  });

  it('applies the template written for the e-mail of the approved member to that e-mail', async () => {
    useChannels({ memberApproved: ['email'] });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      login: 'jdupont',
      fullName: 'Jean Dupont',
      campus: 'Nice',
      email: 'jean@example.fr',
      status: 'MEMBER',
      role: { name: 'Trésorier' },
    } as never);
    given([row('memberApproved', 'email', { subject: 'Welcome aboard, {name}' })]);
    await notifyMemberApproved('u1', 'pmartin');
    expect(delivered().email?.subject).toBe('Welcome aboard, Jean Dupont');
  });

  it('applies the template of a removal to the team’s channels', async () => {
    useChannels({ memberRemoved: ['discord', 'slack'] });
    given([row('memberRemoved', 'all', { title: 'Bye {name}', emoji: '' })]);
    await notifyMemberRemoved({ login: 'jdupont', fullName: 'Jean Dupont' });
    const message = delivered();
    expect(message.discord?.embeds[0]?.title).toBe('Bye Jean Dupont');
    expect(JSON.stringify(message.slack?.blocks)).toContain('Bye Jean Dupont');
  });
});
