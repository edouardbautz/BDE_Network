import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./sender', () => ({ resolveLogoUrl: vi.fn() }));

const { getConfig } = await import('@/config');
const { resolveLogoUrl } = await import('./sender');
const { emailBrand, withEmailContent } = await import('./email-card');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Nice', logoPath: '/logo.svg' },
    notifications: { eventConfirmed: channel, eventReminder: 'email' },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };
const content = { html: '<p>x</p>', text: 'x' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_URL', 'https://bde.example.fr');
  vi.mocked(resolveLogoUrl).mockResolvedValue('https://bde.example.fr/logo.png');
});

describe('emailBrand', () => {
  it('is the name and the logo of the BDE', async () => {
    useChannel('email');
    await expect(emailBrand()).resolves.toEqual({
      name: 'BDE Nice',
      logoUrl: 'https://bde.example.fr/logo.png',
    });
  });

  it('asks for a logo a mail client can load, which need not be public', async () => {
    useChannel('email');
    await emailBrand();
    expect(resolveLogoUrl).toHaveBeenCalledWith('https://bde.example.fr', '/logo.svg', {
      requirePublic: false,
    });
  });

  it('is the name alone when there is no logo to show', async () => {
    useChannel('email');
    vi.mocked(resolveLogoUrl).mockResolvedValue(undefined);
    const brand = await emailBrand();
    expect(brand).toEqual({ name: 'BDE Nice' });
    expect(brand).not.toHaveProperty('logoUrl');
  });
});

describe('withEmailContent', () => {
  it('adds the e-mail, built with the brand, when the channel is e-mail, keeping the plain text', async () => {
    useChannel('email');
    const build = vi.fn(() => content);

    await expect(withEmailContent('eventConfirmed', message, build)).resolves.toEqual({
      subject: 'Sujet',
      body: 'Corps',
      email: content,
    });
    expect(build).toHaveBeenCalledWith({
      name: 'BDE Nice',
      logoUrl: 'https://bde.example.fr/logo.png',
    });
  });

  it.each(['discord', 'slack', 'none'] as const)(
    'builds nothing, and checks no logo, when the channel is %s',
    async (channel) => {
      useChannel(channel);
      const build = vi.fn(() => content);

      await expect(withEmailContent('eventConfirmed', message, build)).resolves.toBe(message);
      expect(build).not.toHaveBeenCalled();
      expect(resolveLogoUrl).not.toHaveBeenCalled();
    },
  );

  it('reads the channel of the event it is given, not another', async () => {
    useChannel('discord'); // eventConfirmed on Discord, eventReminder on e-mail

    expect((await withEmailContent('eventReminder', message, () => content)).email).toBeDefined();
    expect(
      (await withEmailContent('eventConfirmed', message, () => content)).email,
    ).toBeUndefined();
  });
});
