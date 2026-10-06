import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./sender', () => ({ resolveLogoUrl: vi.fn() }));

const { getConfig } = await import('@/config');
const { resolveLogoUrl } = await import('./sender');
const { slackBrand, withSlackBlocks } = await import('./slack-card');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Nice', logoPath: '/logo.svg' },
    notifications: { eventConfirmed: channel, eventReminder: 'slack' },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };
const card = { fallback: 'Résumé', color: '#db2777', blocks: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_URL', 'https://bde.example.fr');
  vi.mocked(resolveLogoUrl).mockResolvedValue('https://bde.example.fr/logo.png');
});

describe('slackBrand', () => {
  it('is the name and the logo of the BDE', async () => {
    useChannel('slack');
    await expect(slackBrand()).resolves.toEqual({
      name: 'BDE Nice',
      logoUrl: 'https://bde.example.fr/logo.png',
    });
  });

  it('asks for a logo Slack can fetch from the Internet: a public address, like Discord', async () => {
    useChannel('slack');
    await slackBrand();
    expect(resolveLogoUrl).toHaveBeenCalledWith('https://bde.example.fr', '/logo.svg');
  });

  it('is the name alone when there is no logo to show', async () => {
    useChannel('slack');
    vi.mocked(resolveLogoUrl).mockResolvedValue(undefined);
    const brand = await slackBrand();
    expect(brand).toEqual({ name: 'BDE Nice' });
    expect(brand).not.toHaveProperty('logoUrl');
  });
});

describe('withSlackBlocks', () => {
  it('adds the card, built with the brand, when the channel is Slack, keeping the plain text', async () => {
    useChannel('slack');
    const build = vi.fn(() => card);

    await expect(withSlackBlocks('eventConfirmed', message, build)).resolves.toEqual({
      subject: 'Sujet',
      body: 'Corps',
      slack: card,
    });
    expect(build).toHaveBeenCalledWith({
      name: 'BDE Nice',
      logoUrl: 'https://bde.example.fr/logo.png',
    });
  });

  it.each(['email', 'discord', 'none'] as const)(
    'builds nothing, and checks no logo, when the channel is %s',
    async (channel) => {
      useChannel(channel);
      const build = vi.fn(() => card);

      await expect(withSlackBlocks('eventConfirmed', message, build)).resolves.toBe(message);
      expect(build).not.toHaveBeenCalled();
      expect(resolveLogoUrl).not.toHaveBeenCalled();
    },
  );

  it('reads the channel of the event it is given, not another', async () => {
    useChannel('discord'); // eventConfirmed on Discord, eventReminder on Slack

    expect((await withSlackBlocks('eventReminder', message, () => card)).slack).toBeDefined();
    expect((await withSlackBlocks('eventConfirmed', message, () => card)).slack).toBeUndefined();
  });
});
