import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./sender', () => ({
  discordSender: vi.fn(async () => ({
    username: 'BDE Nice',
    avatarUrl: 'https://bde.example.fr/logo.png',
  })),
}));

const { getConfig } = await import('@/config');
const { discordSender } = await import('./sender');
const { withDiscordCard } = await import('./discord-card');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    notifications: { eventConfirmed: channel },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };
const embed = { title: 'Soirée' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withDiscordCard', () => {
  it('adds the card, and the sender, when the channel is Discord, keeping the plain text', async () => {
    useChannel('discord');

    await expect(withDiscordCard('eventConfirmed', message, () => embed)).resolves.toEqual({
      subject: 'Sujet',
      body: 'Corps',
      discord: {
        embeds: [embed],
        username: 'BDE Nice',
        avatarUrl: 'https://bde.example.fr/logo.png',
      },
    });
  });

  it.each(['email', 'slack', 'none'] as const)(
    'builds nothing, and checks no logo, when the channel is %s',
    async (channel) => {
      useChannel(channel);
      const card = vi.fn(() => embed);

      await expect(withDiscordCard('eventConfirmed', message, card)).resolves.toBe(message);
      expect(card).not.toHaveBeenCalled();
      expect(discordSender).not.toHaveBeenCalled();
    },
  );

  it('reads the channel of the event it is given, not another', async () => {
    vi.mocked(getConfig).mockReturnValue({
      notifications: { eventConfirmed: 'slack', eventReminder: 'discord' },
    } as unknown as ReturnType<typeof getConfig>);

    expect((await withDiscordCard('eventReminder', message, () => embed)).discord).toBeDefined();
    expect((await withDiscordCard('eventConfirmed', message, () => embed)).discord).toBeUndefined();
  });
});
