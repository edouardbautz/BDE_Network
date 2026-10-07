// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './fortytwo';
import {
  sendDiscordTest,
  sendSlackTest,
  sendTestMail,
  type MailTransport,
  type SmtpSettings,
} from './notify-test';

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/secret-part';

describe('webhook tests', () => {
  it('posts to Discord without pinging anybody', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    await expect(sendDiscordTest(fetchFn, WEBHOOK, 'hello @everyone')).resolves.toEqual({
      ok: true,
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(WEBHOOK);
    expect(JSON.parse(String(init?.body))).toEqual({
      content: 'hello @everyone',
      allowed_mentions: { parse: [] },
    });
  });

  it('posts to Slack', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => new Response('ok'));
    await expect(
      sendSlackTest(fetchFn, 'https://hooks.slack.com/services/T1/B1/x', 'hello'),
    ).resolves.toEqual({ ok: true });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({ text: 'hello' });
  });

  it('says the HTTP status of a refusal', async () => {
    await expect(
      sendDiscordTest(async () => new Response('no', { status: 404 }), WEBHOOK, 'x'),
    ).resolves.toEqual({ ok: false, detail: 'HTTP 404' });
  });

  it('never repeats the webhook address (it is a secret) in what it says about a failure', async () => {
    const result = await sendDiscordTest(
      async () => {
        throw new Error(`request to ${WEBHOOK} failed, reason: getaddrinfo ENOTFOUND`);
      },
      WEBHOOK,
      'x',
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-part');
    expect(JSON.stringify(result)).not.toContain('discord.com');
  });
});

describe('sendTestMail', () => {
  const smtp: SmtpSettings = {
    host: 'smtp.example.org',
    port: 587,
    user: 'bde',
    password: 'hunter2-hunter2',
    from: 'bde@example.org',
  };

  it('sends one message through the transport', async () => {
    const sendMail = vi.fn(async () => undefined);
    const transport: MailTransport = { verify: async () => true, sendMail };
    await expect(
      sendTestMail(() => transport, smtp, 'me@example.org', 'Subject', 'Body'),
    ).resolves.toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'bde@example.org',
      to: 'me@example.org',
      subject: 'Subject',
      text: 'Body',
    });
  });

  it('says why it failed, without the password or the user', async () => {
    const transport: MailTransport = {
      verify: async () => true,
      sendMail: async () => {
        throw Object.assign(new Error('Invalid login: bde / hunter2-hunter2 rejected'), {
          code: 'EAUTH',
        });
      },
    };
    const result = await sendTestMail(() => transport, smtp, 'me@example.org', 's', 'b');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('EAUTH');
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });
});
