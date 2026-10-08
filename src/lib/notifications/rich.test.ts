import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Nice' })),
  resolveLogoUrl: vi.fn(async () => undefined),
}));

const { getConfig } = await import('@/config');
const { withRichMessage } = await import('./rich');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function setChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Nice', logoPath: '/logo.svg' },
    notifications: { eventConfirmed: channel },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };
const builders = () => ({
  discord: vi.fn(() => ({ title: 'carte' })),
  email: vi.fn(() => ({ html: '<p>', text: 'p' })),
  slack: vi.fn(() => ({ fallback: 'f', color: '#000000', blocks: [] })),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withRichMessage', () => {
  it('adds the Discord card when the channel is Discord, and builds nothing else', async () => {
    setChannel('discord');
    const b = builders();
    const out = await withRichMessage('eventConfirmed', message, b);

    expect(out.discord?.embeds).toEqual([{ title: 'carte', author: { name: 'BDE Nice' } }]);
    expect(out).not.toHaveProperty('email');
    expect(out).not.toHaveProperty('slack');
    expect(b.email).not.toHaveBeenCalled();
    expect(b.slack).not.toHaveBeenCalled();
  });

  it('adds the designed e-mail when the channel is e-mail, and builds nothing else', async () => {
    setChannel('email');
    const b = builders();
    const out = await withRichMessage('eventConfirmed', message, b);

    expect(out.email).toEqual({ html: '<p>', text: 'p' });
    expect(out).not.toHaveProperty('discord');
    expect(out).not.toHaveProperty('slack');
    expect(b.discord).not.toHaveBeenCalled();
    expect(b.slack).not.toHaveBeenCalled();
  });

  it('adds the Slack message when the channel is Slack, and builds nothing else', async () => {
    setChannel('slack');
    const b = builders();
    const out = await withRichMessage('eventConfirmed', message, b);

    expect(out.slack).toEqual({ fallback: 'f', color: '#000000', blocks: [] });
    expect(out).not.toHaveProperty('discord');
    expect(out).not.toHaveProperty('email');
    expect(b.discord).not.toHaveBeenCalled();
    expect(b.email).not.toHaveBeenCalled();
  });

  it('adds nothing, and builds nothing, when the channel is none', async () => {
    setChannel('none');
    const b = builders();

    await expect(withRichMessage('eventConfirmed', message, b)).resolves.toBe(message);
    expect(b.discord).not.toHaveBeenCalled();
    expect(b.email).not.toHaveBeenCalled();
    expect(b.slack).not.toHaveBeenCalled();
  });

  it('keeps the plain subject and body whatever it adds', async () => {
    for (const channel of ['discord', 'email', 'slack'] as const) {
      setChannel(channel);
      const out = await withRichMessage('eventConfirmed', message, builders());
      expect(out.subject).toBe('Sujet');
      expect(out.body).toBe('Corps');
    }
  });

  it('only needs the builders of the channels the notification supports (a removal has no e-mail)', async () => {
    setChannel('email');
    const discordOnly = { discord: () => ({ title: 'x' }) };
    await expect(withRichMessage('eventConfirmed', message, discordOnly)).resolves.toBe(message);

    setChannel('discord');
    expect((await withRichMessage('eventConfirmed', message, discordOnly)).discord).toBeDefined();
  });
});
