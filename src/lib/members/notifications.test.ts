import { beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';

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
  prisma: { user: { findMany: vi.fn(), findUnique: vi.fn() } },
}));

const { getConfig } = await import('@/config');
const { deliver } = await import('@/lib/notifications/deliver');
const { prisma } = await import('@/lib/prisma');
const { notifyMemberApproved, notifyMemberPending, notifyMemberRemoved } =
  await import('./notifications');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannels(
  channels: Partial<Record<'memberPending' | 'memberApproved' | 'memberRemoved', Channel>>,
) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', defaultLocale: 'fr' },
    notifications: {
      memberPending: 'none',
      memberApproved: 'none',
      memberRemoved: 'none',
      ...channels,
    },
  } as unknown as ReturnType<typeof getConfig>);
}

/** The arguments of the first call of a mock. */
function firstCall<A extends unknown[]>(mock: { mock: { calls: A[] } }): A {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('never called');
  return call;
}

const pendingUser = {
  login: 'jdupont',
  fullName: 'Jean Dupont',
  campus: 'Nice',
  status: 'PENDING',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('notifyMemberPending', () => {
  it('tells owners and the holders of members.manage (or of every permission), by email', async () => {
    useChannels({ memberPending: 'email' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(pendingUser as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { email: 'owner@x.fr' },
      { email: 'sec@x.fr' },
    ] as never);

    await notifyMemberPending('u1');

    const [query] = firstCall(vi.mocked(prisma.user.findMany));
    expect(query?.where).toEqual({
      OR: [
        { status: 'OWNER' },
        {
          status: 'MEMBER',
          role: { OR: [{ allPermissions: true }, { permissions: { has: 'members.manage' } }] },
        },
      ],
    });
    expect(deliver).toHaveBeenCalledWith(
      'memberPending',
      expect.objectContaining({ subject: "Nouvelle demande d'accès : Jean Dupont" }),
      ['owner@x.fr', 'sec@x.fr'],
      expect.any(String),
    );
  });

  it('names the person, their login and campus, and links to the members page when APP_URL is set', async () => {
    useChannels({ memberPending: 'discord' });
    vi.stubEnv('APP_URL', 'https://bde.exemple.fr/');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(pendingUser as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await notifyMemberPending('u1');

    const message = firstCall(vi.mocked(deliver))[1];
    expect(message.body).toContain('Jean Dupont (jdupont, campus Nice)');
    expect(message.body).toContain('https://bde.exemple.fr/fr/members');
  });

  it('on Discord, an amber card whose title links to the members page', async () => {
    useChannels({ memberPending: 'discord' });
    vi.stubEnv('APP_URL', 'https://bde.exemple.fr/');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(pendingUser as never);

    await notifyMemberPending('u1');

    const embed = firstCall(vi.mocked(deliver))[1].discord?.embeds[0];
    expect(embed?.color).toBe(0xf59e0b);
    expect(embed?.url).toBe('https://bde.exemple.fr/fr/members');
    expect(embed?.fields).toEqual([
      { name: 'Login 42', value: 'jdupont', inline: true },
      { name: 'Campus', value: 'Nice', inline: true },
    ]);
  });

  it('by e-mail, sends the approvers a designed e-mail with the photo and a button to the members page', async () => {
    useChannels({ memberPending: 'email' });
    vi.stubEnv('APP_URL', 'https://bde.exemple.fr/');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...pendingUser,
      photoUrl: 'https://cdn.intra.42.fr/u.jpg',
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ email: 'owner@x.fr' }] as never);

    await notifyMemberPending('u1');

    const [, message, to] = firstCall(vi.mocked(deliver));
    expect(to).toEqual(['owner@x.fr']);
    expect(message.subject).toBe("Nouvelle demande d'accès : Jean Dupont");
    expect(message.email?.html).toContain('<td bgcolor="#f59e0b" height="6"');
    expect(message.email?.html).toContain('src="https://cdn.intra.42.fr/u.jpg" width="64"');
    expect(message.email?.html).toContain('href="https://bde.exemple.fr/fr/members"');
    expect(message).not.toHaveProperty('discord');
  });

  it('sends no e-mail to a chat channel', async () => {
    useChannels({ memberPending: 'slack' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(pendingUser as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await notifyMemberPending('u1');

    expect(firstCall(vi.mocked(deliver))[1]).not.toHaveProperty('email');
  });

  it('has no link at all without APP_URL (never a broken one)', async () => {
    useChannels({ memberPending: 'discord' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(pendingUser as never);

    await notifyMemberPending('u1');

    expect(firstCall(vi.mocked(deliver))[1].discord?.embeds[0]?.url).toBeUndefined();
  });

  it('does nothing when the channel is "none"', async () => {
    useChannels({ memberPending: 'none' });

    await notifyMemberPending('u1');

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does nothing once the request is no longer pending (approved before the message went out)', async () => {
    useChannels({ memberPending: 'slack' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...pendingUser,
      status: 'MEMBER',
    } as never);

    await notifyMemberPending('u1');

    expect(deliver).not.toHaveBeenCalled();
  });

  it('never throws, even when the database or the delivery fails', async () => {
    useChannels({ memberPending: 'email' });
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('db down'));

    await expect(notifyMemberPending('u1')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('notifyMemberApproved', () => {
  const approved = {
    login: 'jdupont',
    fullName: 'Jean Dupont',
    email: 'jean@x.fr',
    status: 'MEMBER',
    role: { name: 'Trésorier' },
  };

  it('writes to the approved member, and only to them, when the channel is email', async () => {
    useChannels({ memberApproved: 'email' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(approved as never);

    await notifyMemberApproved('u1');

    expect(deliver).toHaveBeenCalledWith(
      'memberApproved',
      expect.objectContaining({ subject: 'Votre accès à BDE Test est validé' }),
      ['jean@x.fr'],
      expect.any(String),
    );
    expect(firstCall(vi.mocked(deliver))[1].body).toContain('Votre rôle : Trésorier.');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it.each(['discord', 'slack'] as const)(
    'posts a message for the team on %s, not a letter to the member',
    async (channel) => {
      useChannels({ memberApproved: channel });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(approved as never);

      await notifyMemberApproved('u1');

      const message = firstCall(vi.mocked(deliver))[1];
      expect(message.subject).toBe('Demande approuvée : Jean Dupont');
      expect(message.body).toBe('Jean Dupont (jdupont) a rejoint le BDE avec le rôle Trésorier.');
      expect(message.body).not.toContain('Bonjour');
    },
  );

  it('on Discord, a green card with the role, their photo and who approved', async () => {
    useChannels({ memberApproved: 'discord' });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        ...approved,
        campus: 'Nice',
        photoUrl: 'https://cdn.intra.42.fr/u.jpg',
      } as never)
      .mockResolvedValueOnce({ fullName: 'Paula Martin' } as never); // the approver

    await notifyMemberApproved('u1', 'pmartin');

    const card = firstCall(vi.mocked(deliver))[1].discord;
    expect(card?.username).toBe('BDE Test');
    const embed = card?.embeds[0];
    expect(embed?.color).toBe(0x10b981);
    expect(embed?.title).toBe('Jean Dupont');
    expect(embed?.thumbnail?.url).toBe('https://cdn.intra.42.fr/u.jpg');
    expect(embed?.fields).toEqual(
      expect.arrayContaining([
        { name: 'Rôle', value: 'Trésorier', inline: true },
        { name: 'Approuvé par', value: 'Paula Martin', inline: true },
      ]),
    );
  });

  it('by e-mail, welcomes the member with their role and a button to sign in, without their photo', async () => {
    useChannels({ memberApproved: 'email' });
    vi.stubEnv('APP_URL', 'https://bde.exemple.fr');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...approved,
      photoUrl: 'https://cdn.intra.42.fr/u.jpg',
    } as never);

    await notifyMemberApproved('u1', 'pmartin');

    const [, message, to] = firstCall(vi.mocked(deliver));
    expect(to).toEqual(['jean@x.fr']);
    expect(message.email?.html).toContain('<td bgcolor="#10b981" height="6"');
    expect(message.email?.text).toContain('Rôle : Trésorier');
    expect(message.email?.html).toContain('href="https://bde.exemple.fr/fr"');
    expect(message.email?.html).not.toContain('width="64"');
    expect(message).not.toHaveProperty('discord');
  });

  it('sends no card to Slack or email: only the plain text', async () => {
    useChannels({ memberApproved: 'slack' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(approved as never);

    await notifyMemberApproved('u1', 'pmartin');

    expect(firstCall(vi.mocked(deliver))[1].discord).toBeUndefined();
  });

  it('does nothing when the channel is "none", or when the account is not an approved member', async () => {
    useChannels({ memberApproved: 'none' });
    await notifyMemberApproved('u1');
    expect(deliver).not.toHaveBeenCalled();

    useChannels({ memberApproved: 'email' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...approved,
      status: 'PENDING',
      role: null,
    } as never);
    await notifyMemberApproved('u1');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await notifyMemberApproved('u1');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('never throws when the delivery layer does', async () => {
    useChannels({ memberApproved: 'email' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(approved as never);
    vi.mocked(deliver).mockRejectedValue(new Error('boom'));

    await expect(notifyMemberApproved('u1')).resolves.toBeUndefined();
  });
});

describe('notifyMemberRemoved', () => {
  const removed = { login: 'jdupont', fullName: 'Jean Dupont' };

  it.each(['discord', 'slack'] as const)(
    'posts to the %s channel, with nobody to email',
    async (channel) => {
      useChannels({ memberRemoved: channel });

      await notifyMemberRemoved(removed);

      expect(deliver).toHaveBeenCalledWith(
        'memberRemoved',
        expect.objectContaining({
          subject: 'Membre retiré : Jean Dupont',
          body: 'Jean Dupont (jdupont) a été retiré du BDE.',
        }),
        [],
        expect.any(String),
      );
    },
  );

  it('on Discord, a red card that says who removed them', async () => {
    useChannels({ memberRemoved: 'discord' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ fullName: 'Paula Martin' } as never);

    await notifyMemberRemoved({ ...removed, roleName: 'Membre' }, 'pmartin');

    const embed = firstCall(vi.mocked(deliver))[1].discord?.embeds[0];
    expect(embed?.color).toBe(0xef4444);
    expect(embed?.fields).toEqual(
      expect.arrayContaining([{ name: 'Retiré par', value: 'Paula Martin', inline: true }]),
    );
  });

  it('never emails the removed member: the email channel sends nothing', async () => {
    useChannels({ memberRemoved: 'email' });

    await notifyMemberRemoved(removed);

    expect(deliver).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('does nothing when the channel is "none"', async () => {
    useChannels({ memberRemoved: 'none' });
    await notifyMemberRemoved(removed);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    vi.mocked(getConfig).mockImplementation(() => {
      throw new Error('no config');
    });
    await expect(notifyMemberRemoved(removed)).resolves.toBeUndefined();
  });
});

describe('messages', () => {
  it('exist in French and English with the same placeholders', async () => {
    const en = (await import('../../../messages/en.json')).default;
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === 'string') {
        expect(typeof b, path).toBe('string');
        expect(placeholders(b as string), path).toEqual(placeholders(a));
      } else {
        for (const key of Object.keys(a as object)) {
          walk(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key],
            `${path}.${key}`,
          );
        }
      }
    };
    walk(fr.members.notifications, en.members.notifications, 'members.notifications');
  });
});
