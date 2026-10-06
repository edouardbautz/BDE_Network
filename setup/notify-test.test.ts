// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SmtpAnswers } from './answers';
import type { FetchLike } from './fortytwo';
import {
  sendDiscordTest,
  sendSlackTest,
  sendTestMail,
  verifySmtp,
  type MailTransport,
} from './notify-test';

const DISCORD = 'https://discord.com/api/webhooks/123/very-secret-token';
const SLACK = 'https://hooks.slack.com/services/T0AAA/B0BBB/very-secret-token';

function recorder(status = 204) {
  const calls: Array<{ url: string; body: unknown; method: string | undefined }> = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), method: init?.method });
    return new Response(null, { status });
  };
  return { fetchFn, calls };
}

describe('sendDiscordTest', () => {
  it('posts the text to the webhook, and can ping nobody', async () => {
    const { fetchFn, calls } = recorder();
    await expect(sendDiscordTest(fetchFn, DISCORD, 'Bonjour @everyone')).resolves.toEqual({
      ok: true,
    });

    expect(calls).toEqual([
      {
        url: DISCORD,
        method: 'POST',
        body: { content: 'Bonjour @everyone', allowed_mentions: { parse: [] } },
      },
    ]);
  });

  it('reports the HTTP status when Discord refuses, without the address', async () => {
    const { fetchFn } = recorder(404);
    const result = await sendDiscordTest(fetchFn, DISCORD, 'x');
    expect(result).toEqual({ ok: false, detail: 'HTTP 404' });
    expect(JSON.stringify(result)).not.toContain('very-secret-token');
  });

  it('reports a network failure without the address, even if the error holds it', async () => {
    const failing: FetchLike = async (url) => {
      throw new Error(`getaddrinfo ENOTFOUND ${url}`);
    };
    const result = await sendDiscordTest(failing, DISCORD, 'x');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('very-secret-token');
    expect(JSON.stringify(result)).not.toContain('discord.com');
  });
});

describe('sendSlackTest', () => {
  it('posts the text to the webhook', async () => {
    const { fetchFn, calls } = recorder(200);
    await expect(sendSlackTest(fetchFn, SLACK, 'Bonjour')).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ url: SLACK, method: 'POST', body: { text: 'Bonjour' } }]);
  });

  it('reports the HTTP status when Slack refuses', async () => {
    const { fetchFn } = recorder(403);
    expect(await sendSlackTest(fetchFn, SLACK, 'x')).toEqual({ ok: false, detail: 'HTTP 403' });
  });

  it('reports a network failure without the address', async () => {
    const failing: FetchLike = async () => {
      throw new Error(`connect failed to ${SLACK}`);
    };
    const result = await sendSlackTest(failing, SLACK, 'x');
    expect(JSON.stringify(result)).not.toContain('very-secret-token');
  });
});

describe('SMTP checks', () => {
  const smtp: SmtpAnswers = {
    host: 'smtp.exemple.fr',
    port: 587,
    user: 'bde@exemple.fr',
    password: 'hunter2-hunter2',
    from: 'bde@exemple.fr',
  };

  const transport = (over: Partial<MailTransport> = {}) => {
    const verify = vi.fn(async () => true);
    const sendMail = vi.fn(async () => ({}));
    const factory = vi.fn((): MailTransport => ({ verify, sendMail, ...over }));
    return { factory, verify, sendMail };
  };

  it('verifies the connection and the login, without sending anything', async () => {
    const t = transport();
    await expect(verifySmtp(t.factory, smtp)).resolves.toEqual({ ok: true });
    expect(t.factory).toHaveBeenCalledWith(smtp);
    expect(t.verify).toHaveBeenCalledTimes(1);
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('describes a refused login, with its code and without the password or the user', async () => {
    const t = transport({
      verify: async () => {
        throw Object.assign(new Error(`Invalid login for bde@exemple.fr with hunter2-hunter2`), {
          code: 'EAUTH',
        });
      },
    });
    const result = await verifySmtp(t.factory, smtp);

    expect(result).toEqual({ ok: false, detail: 'EAUTH: Invalid login for *** with ***' });
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('hides URLs and cuts a long description', async () => {
    const t = transport({
      verify: async () => {
        throw new Error(`see https://secret.example/a?token=1 ${'x'.repeat(500)}`);
      },
    });
    const result = await verifySmtp(t.factory, smtp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).not.toContain('secret.example');
      expect(result.detail.length).toBeLessThanOrEqual(200);
    }
  });

  it('says "unknown error" for something that is not an Error', async () => {
    const t = transport({
      verify: async () => {
        throw 'boom';
      },
    });
    expect(await verifySmtp(t.factory, smtp)).toEqual({ ok: false, detail: 'unknown error' });
  });

  it('sends the test mail from the configured address to the recipient', async () => {
    const t = transport();
    await expect(
      sendTestMail(t.factory, smtp, 'moi@exemple.fr', 'Sujet', 'Corps'),
    ).resolves.toEqual({ ok: true });
    expect(t.sendMail).toHaveBeenCalledWith({
      from: 'bde@exemple.fr',
      to: 'moi@exemple.fr',
      subject: 'Sujet',
      text: 'Corps',
    });
  });

  it('describes a failed send without the password', async () => {
    const t = transport({
      sendMail: async () => {
        throw Object.assign(new Error('550 rejected, password hunter2-hunter2'), {
          code: 'EENVELOPE',
        });
      },
    });
    const result = await sendTestMail(t.factory, smtp, 'moi@exemple.fr', 's', 'b');
    expect(result).toEqual({ ok: false, detail: 'EENVELOPE: 550 rejected, password ***' });
  });
});

describe('realTransport', () => {
  it('connects with the settings it is given: secure only on port 465, a login only when there is a user', async () => {
    const created: unknown[] = [];
    vi.resetModules();
    vi.doMock('nodemailer', () => ({
      createTransport: (options: unknown) => (created.push(options), {}),
    }));
    const { realTransport } = await import('./notify-test');

    realTransport({
      host: 'smtp.exemple.fr',
      port: 465,
      user: 'bde',
      password: 'pw',
      from: 'a@b.fr',
    });
    realTransport({ host: 'smtp.exemple.fr', port: 587, user: '', password: '', from: 'a@b.fr' });
    vi.doUnmock('nodemailer');

    expect(created[0]).toMatchObject({
      host: 'smtp.exemple.fr',
      port: 465,
      secure: true,
      auth: { user: 'bde', pass: 'pw' },
    });
    expect(created[1]).toMatchObject({
      host: 'smtp.exemple.fr',
      port: 587,
      secure: false,
      auth: undefined,
    });
    expect(created[0]).toMatchObject({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  });
});
