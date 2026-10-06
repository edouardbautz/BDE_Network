import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from './discord';
import { SlackAdapter } from './slack';

/** What the chat adapters really post: the payload, and that no text can ping a whole server. */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.example/api/webhooks/1/abc');
  vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.example/services/T/B/x');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** What the adapter sent: the URL, and the JSON body it posted. */
function sent(): { url: string; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls[0] as [string, { body: string }] | undefined;
  if (!call) throw new Error('nothing was posted');
  return { url: call[0], body: JSON.parse(call[1].body) };
}
const posted = () => sent().body;

describe('DiscordAdapter', () => {
  it('posts the subject in bold, then the body, to the webhook', async () => {
    await new DiscordAdapter().send({ subject: 'Sujet', body: 'Corps' });

    expect(sent().url).toBe('https://discord.example/api/webhooks/1/abc');
    expect(posted().content).toBe('**Sujet**\nCorps');
  });

  it('allows no mention at all, whatever the text says', async () => {
    await new DiscordAdapter().send({ subject: '@everyone', body: 'Salut @here <@123>' });

    expect(posted().allowed_mentions).toEqual({ parse: [] });
  });

  it('defuses @everyone and @here in the subject and the body (a member name or event title)', async () => {
    await new DiscordAdapter().send({
      subject: 'Nouvelle demande : @everyone',
      body: 'Jean @here Dupont (jean) demande l’accès',
    });

    const { content } = posted();
    expect(content).not.toContain('@everyone');
    expect(content).not.toContain('@here');
    expect(content).toContain('Jean');
  });

  it('fails clearly without a webhook, and when Discord answers with an error', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', '');
    await expect(new DiscordAdapter().send({ subject: 's', body: 'b' })).rejects.toThrow(
      'DISCORD_WEBHOOK_URL',
    );

    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.example/x');
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(new DiscordAdapter().send({ subject: 's', body: 'b' })).rejects.toThrow('429');
  });
});

describe('DiscordAdapter with cards', () => {
  const card = (overrides: Record<string, unknown> = {}) => ({
    title: 'Soirée',
    url: 'https://bde.example.fr/fr/events/1',
    color: 0xdb2777,
    description: '**Nouvel événement confirmé**',
    fields: [{ name: 'Lieu', value: 'Foyer', inline: true }],
    footer: { text: 'BDE_Network' },
    ...overrides,
  });

  it('posts the cards, under the BDE name and logo, instead of the plain text', async () => {
    await new DiscordAdapter().send({
      subject: 'Sujet',
      body: 'Corps',
      discord: {
        embeds: [card()],
        username: 'BDE Nice',
        avatarUrl: 'https://bde.example.fr/logo.png',
      },
    });

    const body = posted();
    expect(body.content).toBeUndefined();
    expect(body.username).toBe('BDE Nice');
    expect(body.avatar_url).toBe('https://bde.example.fr/logo.png');
    expect(body.embeds).toEqual([card()]);
  });

  it('sends no sender fields when there is no name or logo (the webhook keeps its own)', async () => {
    await new DiscordAdapter().send({ subject: 's', body: 'b', discord: { embeds: [card()] } });

    expect(posted()).not.toHaveProperty('username');
    expect(posted()).not.toHaveProperty('avatar_url');
  });

  it('still allows no mention at all', async () => {
    await new DiscordAdapter().send({
      subject: 's',
      body: 'b',
      discord: { embeds: [card({ title: '@everyone <@123>' })] },
    });

    expect(posted().allowed_mentions).toEqual({ parse: [] });
  });

  it('defuses mentions in every text of the card: title, description, fields, footer and sender name', async () => {
    await new DiscordAdapter().send({
      subject: 's',
      body: 'b',
      discord: {
        username: 'BDE @everyone',
        embeds: [
          card({
            title: 'Fête @everyone <@123456789>',
            description: 'Salut @here <!channel>',
            fields: [{ name: '@here', value: 'Salle <#42> @everyone' }],
            footer: { text: '@everyone' },
          }),
        ],
      },
    });

    const text = JSON.stringify(posted());
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('@here');
    expect(text).not.toContain('<@');
    expect(text).not.toContain('<!');
    expect(text).not.toContain('<#');
  });

  it('leaves the link, the colour and the date markup of a card untouched', async () => {
    const quand = { name: 'Quand', value: '<t:1791396000:F> → <t:1791406800:t>' };
    await new DiscordAdapter().send({
      subject: 's',
      body: 'b',
      discord: { embeds: [card({ fields: [quand] })] },
    });

    const [embed] = posted().embeds as Array<Record<string, unknown>>;
    expect(embed?.url).toBe('https://bde.example.fr/fr/events/1');
    expect(embed?.color).toBe(0xdb2777);
    expect(embed?.fields).toEqual([quand]);
  });

  it('cuts texts that are too long for Discord instead of having the message refused', async () => {
    await new DiscordAdapter().send({
      subject: 's',
      body: 'b',
      discord: { embeds: [card({ title: 'T'.repeat(400), description: 'D'.repeat(5000) })] },
    });

    const [embed] = posted().embeds as Array<{ title: string; description: string }>;
    expect(Array.from(embed?.title ?? '')).toHaveLength(256);
    expect(Array.from(embed?.description ?? '').length).toBeLessThanOrEqual(4096);
  });

  it('sends at most ten cards, the most Discord takes in one message', async () => {
    await new DiscordAdapter().send({
      subject: 's',
      body: 'b',
      discord: { embeds: Array.from({ length: 12 }, () => card()) },
    });

    expect(posted().embeds).toHaveLength(10);
  });

  it('falls back to the plain text when there is no card to show', async () => {
    await new DiscordAdapter().send({ subject: 'Sujet', body: 'Corps', discord: { embeds: [] } });

    expect(posted().content).toBe('**Sujet**\nCorps');
    expect(posted()).not.toHaveProperty('embeds');
  });

  it('fails when Discord refuses the cards, so the failure is logged by deliver()', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(
      new DiscordAdapter().send({ subject: 's', body: 'b', discord: { embeds: [card()] } }),
    ).rejects.toThrow('400');
  });
});

describe('SlackAdapter', () => {
  it('ignores the Discord cards of a message, and posts its plain text', async () => {
    await new SlackAdapter().send({
      subject: 'Sujet',
      body: 'Corps',
      discord: { embeds: [{ title: 'x' }] },
    });

    expect(posted().text).toBe('*Sujet*\nCorps');
    expect(JSON.stringify(posted())).not.toContain('embeds');
  });

  it('posts the subject in bold, then the body, to the webhook', async () => {
    await new SlackAdapter().send({ subject: 'Sujet', body: 'Corps' });

    expect(sent().url).toBe('https://hooks.slack.example/services/T/B/x');
    expect(posted().text).toBe('*Sujet*\nCorps');
  });

  it('turns <!channel>, <!here> and links typed by a member into plain text', async () => {
    await new SlackAdapter().send({
      subject: 'Événement <!channel>',
      body: 'Lieu : <!here> <https://evil.example|ici> @everyone',
    });

    const { text } = posted();
    expect(text).not.toContain('<!');
    expect(text).not.toContain('<https');
    expect(text).not.toContain('@everyone');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('fails clearly without a webhook, and when Slack answers with an error', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', '');
    await expect(new SlackAdapter().send({ subject: 's', body: 'b' })).rejects.toThrow(
      'SLACK_WEBHOOK_URL',
    );

    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.example/x');
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(new SlackAdapter().send({ subject: 's', body: 'b' })).rejects.toThrow('500');
  });
});
