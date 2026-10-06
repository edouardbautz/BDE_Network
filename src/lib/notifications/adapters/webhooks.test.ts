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

describe('SlackAdapter with cards', () => {
  const card = (over: Record<string, unknown> = {}) => ({
    fallback: 'Nouvel événement confirmé : Soirée',
    color: '#db2777',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Soirée' } },
      { type: 'section', text: { type: 'mrkdwn', text: 'Corps' } },
    ],
    ...over,
  });
  const send = (slack: unknown, over: Record<string, unknown> = {}) =>
    new SlackAdapter().send({ subject: 'Sujet', body: 'Corps', slack, ...over } as never);

  interface Attachment {
    color: string;
    fallback: string;
    blocks: Array<Record<string, unknown>>;
  }
  const attachments = () => posted().attachments as Attachment[];

  it('posts the card as one coloured attachment holding the blocks', async () => {
    await send(card());

    expect(attachments()).toHaveLength(1);
    expect(attachments()[0]?.color).toBe('#db2777');
    expect(attachments()[0]?.blocks.map((block) => block.type)).toEqual(['header', 'section']);
    expect(sent().url).toBe('https://hooks.slack.example/services/T/B/x');
  });

  // A message with a `text` shows it in the channel, above the card, which then says it all twice.
  it('never posts a text of its own: the message is the attachment, nothing else', async () => {
    await send(card());

    expect(Object.keys(posted())).toEqual(['attachments']);
    expect(posted()).not.toHaveProperty('text');
    expect(posted()).not.toHaveProperty('blocks');
    expect(JSON.stringify(posted())).not.toContain('Sujet');
  });

  it('puts the summary for notifications in the attachment fallback', async () => {
    await send(card());

    expect(attachments()[0]?.fallback).toBe('Nouvel événement confirmé : Soirée');
    expect(Object.keys(attachments()[0] ?? {}).sort()).toEqual(['blocks', 'color', 'fallback']);
  });

  it('defuses mentions in every text of the card, and in the summary', async () => {
    await send(
      card({
        fallback: '@channel <!channel> <@U1>',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Fête @everyone <!channel>' } },
          { type: 'section', text: { type: 'mrkdwn', text: '<!here> <@U123> <#C1> @here' } },
          {
            type: 'section',
            fields: [{ type: 'mrkdwn', text: '*Lieu*\n<https://evil.example|ici> @channel' }],
          },
        ],
      }),
    );

    const json = JSON.stringify(posted());
    for (const bad of [
      '@everyone',
      '@here',
      '@channel',
      '<!channel',
      '<!here',
      '<@U',
      '<#C',
      '<https',
    ]) {
      expect(json).not.toContain(bad);
    }
  });

  it('leaves the date markup of a card untouched', async () => {
    const when = '*Quand*\n<!date^1791655200^{date_long_pretty} {time}|samedi 20:00>';
    await send(card({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: when } }] }));

    const [block] = attachments()[0]?.blocks ?? [];
    expect((block?.text as { text: string }).text).toBe(when);
  });

  it('cuts texts that are too long for Slack instead of having the message refused', async () => {
    await send(
      card({
        fallback: 'f'.repeat(1000),
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'T'.repeat(400) } },
          { type: 'section', text: { type: 'mrkdwn', text: 'D'.repeat(5000) } },
        ],
      }),
    );

    const [header, body] = attachments()[0]?.blocks ?? [];
    expect(Array.from((header?.text as { text: string }).text)).toHaveLength(150);
    expect(Array.from((body?.text as { text: string }).text)).toHaveLength(3000);
    expect(Array.from(attachments()[0]?.fallback ?? '')).toHaveLength(300);
  });

  it('keeps at most 50 blocks, and drops those Slack would refuse', async () => {
    await send(
      card({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '' } },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Voir' },
                url: 'javascript:alert(1)',
              },
            ],
          },
          ...Array.from({ length: 60 }, () => ({
            type: 'section',
            text: { type: 'mrkdwn', text: 'x' },
          })),
        ],
      }),
    );

    expect(attachments()[0]?.blocks).toHaveLength(50);
    expect(attachments()[0]?.blocks.every((block) => block.type === 'section')).toBe(true);
  });

  it('falls back to the plain text of the message when nothing is left of the card', async () => {
    await send(card({ blocks: [{ type: 'header', text: { type: 'plain_text', text: '' } }] }));

    expect(posted().text).toBe('*Sujet*\nCorps');
    expect(posted()).not.toHaveProperty('attachments');
  });

  it('keeps the plain text for a message with no card', async () => {
    await new SlackAdapter().send({ subject: 'Sujet', body: 'Corps' });

    expect(posted().text).toBe('*Sujet*\nCorps');
    expect(posted()).not.toHaveProperty('attachments');
  });

  it('is ignored by the Discord adapter, which posts its own cards or the plain text', async () => {
    await new DiscordAdapter().send({
      subject: 'Sujet',
      body: 'Corps',
      slack: card(),
    } as never);

    expect(posted().content).toBe('**Sujet**\nCorps');
    expect(JSON.stringify(posted())).not.toContain('attachments');
  });

  it('fails when Slack refuses the card, so the failure is logged by deliver()', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(send(card())).rejects.toThrow('400');
  });
});
