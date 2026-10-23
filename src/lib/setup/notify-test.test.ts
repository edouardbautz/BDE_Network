// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveAccent } from '@/lib/color';
import { sendTestMessage, type SmtpSettings } from './notify-test';

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), options: [] as unknown[] }));
vi.mock('nodemailer', () => ({
  createTransport: (options: unknown) => {
    mail.options.push(options);
    return { sendMail: mail.sendMail, close: mail.close };
  },
}));

const DISCORD = 'https://discord.com/api/webhooks/123456789/secret-part';
const SLACK = 'https://hooks.slack.com/services/T1/B1/slacksecret';
const SMTP: SmtpSettings = {
  host: 'smtp.exemple.fr',
  port: 587,
  user: 'bde',
  password: 'p4ss-secret',
  from: 'bde@exemple.fr',
};

const context = (locale: 'fr' | 'en' = 'fr') => ({
  name: 'BDE Test',
  locale,
  timeZone: 'Europe/Paris',
  accent: '#2F5BEA',
  installed: false,
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mail.sendMail.mockReset();
  mail.options.length = 0;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const posted = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

describe('the test message of a channel: the real presentation, with an invented event', () => {
  it('Discord: a card with the BDE as its sender, in the colour of the BDE, that pings nobody', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      sendTestMessage('discord', { discordWebhook: DISCORD }, context()),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(DISCORD);
    const body = posted();
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.username).toBe('BDE Test');
    const [embed] = body.embeds;
    expect(embed.title).toContain('Soirée jeux (exemple)');
    expect(embed.description).toContain('MESSAGE DE TEST');
    expect(embed.color).toBe(parseInt(deriveAccent('#2F5BEA', 'light').fill.slice(1), 16));
    expect(embed.author).toEqual({ name: 'BDE Test' });
  });

  it('Slack: blocks under the colour bar, with no text of its own', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));

    await expect(sendTestMessage('slack', { slackWebhook: SLACK }, context('en'))).resolves.toEqual(
      {
        ok: true,
      },
    );

    const body = posted();
    expect(body.text).toBeUndefined();
    const [attachment] = body.attachments;
    expect(attachment.color).toBe(deriveAccent('#2F5BEA', 'light').fill.toLowerCase());
    const header = attachment.blocks.find((block: { type: string }) => block.type === 'header');
    expect(header.text.text).toBe('Game night (example)');
    expect(JSON.stringify(attachment.blocks)).toContain('Test message');
  });

  it('e-mail: the designed e-mail, to the address given, through the server typed', async () => {
    mail.sendMail.mockResolvedValue({});

    await expect(
      sendTestMessage('email', { smtp: SMTP }, context(), 'me@exemple.fr'),
    ).resolves.toEqual({ ok: true });

    expect(mail.options[0]).toMatchObject({
      host: 'smtp.exemple.fr',
      port: 587,
      auth: { user: 'bde', pass: 'p4ss-secret' },
    });
    const sent = mail.sendMail.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      from: 'bde@exemple.fr',
      to: 'me@exemple.fr',
      subject: 'Test de BDE Test',
    });
    expect(sent.html).toContain('Soirée jeux (exemple)');
    expect(sent.html).toContain('message de test');
    expect(sent.text).toContain('Soirée jeux (exemple)');
  });

  it('only the channel asked for is touched: no card is posted for a test of the e-mail', async () => {
    mail.sendMail.mockResolvedValue({});
    await sendTestMessage(
      'email',
      { smtp: SMTP, discordWebhook: DISCORD },
      context(),
      'me@exemple.fr',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the status of a refusal, and never an address or a secret', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 404 }));
    const result = await sendTestMessage('discord', { discordWebhook: DISCORD }, context());
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('404');
    expect(JSON.stringify(result)).not.toContain('secret-part');

    fetchMock.mockRejectedValue(new Error(`getaddrinfo failed for ${DISCORD}`));
    const network = await sendTestMessage('discord', { discordWebhook: DISCORD }, context());
    expect(JSON.stringify(network)).not.toContain('secret-part');
    expect(JSON.stringify(network)).not.toContain('discord.com');
  });

  it('a mail server that refuses is a short reason, without the password', async () => {
    mail.sendMail.mockRejectedValue(
      Object.assign(new Error('Invalid login p4ss-secret'), { code: 'EAUTH' }),
    );
    const result = await sendTestMessage('email', { smtp: SMTP }, context(), 'me@exemple.fr');
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('EAUTH');
    expect(JSON.stringify(result)).not.toContain('p4ss-secret');
  });

  it('a channel with nothing to send through is not configured, and nothing is sent', async () => {
    expect(await sendTestMessage('slack', {}, context())).toEqual({
      ok: false,
      detail: 'not configured',
    });
    expect(await sendTestMessage('email', { smtp: SMTP }, context())).toEqual({
      ok: false,
      detail: 'not configured', // no address to send the test to
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});
