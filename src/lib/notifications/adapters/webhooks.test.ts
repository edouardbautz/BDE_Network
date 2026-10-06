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

describe('SlackAdapter', () => {
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
