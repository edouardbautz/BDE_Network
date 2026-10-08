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
const { signCard, withDiscordCard } = await import('./discord-card');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    notifications: { eventConfirmed: channel },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };
const embed = { title: 'Soirée' };
const signedEmbed = {
  title: 'Soirée',
  author: { name: 'BDE Nice', icon_url: 'https://bde.example.fr/logo.png' },
  thumbnail: { url: 'https://bde.example.fr/logo.png' },
};

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
        embeds: [signedEmbed],
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

describe('signCard', () => {
  const sender = { username: 'BDE Nice', avatarUrl: 'https://bde.example.fr/logo.png' };

  it('puts the name and the logo of the BDE above the title, and the logo as the thumbnail', () => {
    expect(signCard({ title: 'Soirée' }, sender)).toEqual({
      title: 'Soirée',
      author: { name: 'BDE Nice', icon_url: 'https://bde.example.fr/logo.png' },
      thumbnail: { url: 'https://bde.example.fr/logo.png' },
    });
  });

  it('keeps the picture a card already has (the 42 photo of a member)', () => {
    const photo = { url: 'https://cdn.intra.42.fr/u.jpg' };

    expect(signCard({ title: 'Jean', thumbnail: photo }, sender).thumbnail).toEqual(photo);
  });

  it('shows no logo, nowhere, when Discord cannot fetch it: the name alone, never a broken picture', () => {
    const signed = signCard({ title: 'Soirée' }, { username: 'BDE Nice' });

    expect(signed.author).toEqual({ name: 'BDE Nice' });
    expect(signed).not.toHaveProperty('thumbnail');
  });

  it('adds nothing when the sender has no name either', () => {
    expect(signCard({ title: 'Soirée' }, {})).toEqual({ title: 'Soirée' });
  });
});
