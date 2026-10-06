// @vitest-environment node
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmailAdapter } from './email';

/**
 * Sends through the real nodemailer to a minimal SMTP server running in this
 * process, so an upgrade of nodemailer (or a change to the adapter) is checked
 * against what actually goes over the wire, not against a mock.
 */

interface Delivery {
  mailFrom: string;
  rcptTo: string[];
  data: string;
  credentials?: { user: string; password: string };
}

interface TestSmtpServer {
  port: number;
  deliveries: Delivery[];
  /** How many TCP connections the server has accepted. */
  connections: () => number;
  close: () => Promise<void>;
}

function startSmtpServer(): Promise<TestSmtpServer> {
  const deliveries: Delivery[] = [];
  let connections = 0;

  const server: Server = createServer((socket: Socket) => {
    connections += 1;
    let draft: Delivery = { mailFrom: '', rcptTo: [], data: '' };
    let credentials: Delivery['credentials'];
    let inData = false;
    let buffer = '';
    const reply = (line: string) => socket.write(`${line}\r\n`);

    const onCommand = (line: string) => {
      const command = line.toUpperCase();
      if (command.startsWith('EHLO') || command.startsWith('HELO')) {
        reply('250-test.local');
        reply('250-AUTH PLAIN');
        reply('250 8BITMIME');
      } else if (command.startsWith('AUTH PLAIN ')) {
        const [, user = '', password = ''] = Buffer.from(line.slice('AUTH PLAIN '.length), 'base64')
          .toString('utf8')
          .split('\0');
        credentials = { user, password };
        reply('235 Authentication successful');
      } else if (command.startsWith('MAIL FROM:')) {
        draft.mailFrom = /<([^>]*)>/.exec(line)?.[1] ?? '';
        reply('250 OK');
      } else if (command.startsWith('RCPT TO:')) {
        const recipient = /<([^>]*)>/.exec(line)?.[1] ?? '';
        if (recipient.startsWith('bad@')) {
          reply('550 mailbox unavailable');
        } else {
          draft.rcptTo.push(recipient);
          reply('250 OK');
        }
      } else if (command === 'DATA') {
        inData = true;
        reply('354 End data with <CR><LF>.<CR><LF>');
      } else if (command === 'QUIT') {
        reply('221 Bye');
        socket.end();
      } else {
        reply('250 OK');
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          draft.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          deliveries.push({ ...draft, credentials });
          draft = { mailFrom: '', rcptTo: [], data: '' };
          reply('250 Queued');
          continue;
        }
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        onCommand(line);
      }
    });
    reply('220 test.local ESMTP');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        deliveries,
        connections: () => connections,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** Decodes RFC 2047 encoded words (=?UTF-8?Q?...?= / =?UTF-8?B?...?=) in a header. */
function decodeMimeWords(header: string): string {
  return header.replace(
    /=\?UTF-8\?([QB])\?([^?]*)\?=/gi,
    (_match, encoding: string, text: string) => {
      if (encoding.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString('utf8');
      const bytes = text
        .replace(/_/g, ' ')
        .replace(/=([0-9A-F]{2})/gi, (_hex, code: string) =>
          String.fromCharCode(parseInt(code, 16)),
        );
      return Buffer.from(bytes, 'latin1').toString('utf8');
    },
  );
}

const SMTP_VARIABLES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_FROM',
  'SMTP_USER',
  'SMTP_PASSWORD',
] as const;
const savedEnv = Object.fromEntries(SMTP_VARIABLES.map((name) => [name, process.env[name]]));

let smtp: TestSmtpServer;

beforeEach(async () => {
  smtp = await startSmtpServer();
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_FROM = 'BDE Test <bde@example.org>';
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
});

afterEach(async () => {
  await smtp.close();
  for (const name of SMTP_VARIABLES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe('EmailAdapter', () => {
  it('delivers the message to the recipient through the configured SMTP server', async () => {
    await new EmailAdapter().send({
      to: 'alice@example.org',
      subject: 'Rappel : Soirée de rentrée',
      body: 'Ligne un\nLigne deux',
    });

    expect(smtp.deliveries).toHaveLength(1);
    const delivery = smtp.deliveries[0];
    if (!delivery) throw new Error('no message was delivered');
    expect(delivery.mailFrom).toBe('bde@example.org');
    expect(delivery.rcptTo).toEqual(['alice@example.org']);
    expect(delivery.data).toMatch(/^From: .*bde@example\.org/m);
    expect(delivery.data).toMatch(/^To: alice@example\.org/m);
    expect(delivery.data).toMatch(/^Content-Type: text\/plain; charset=utf-8/m);
    expect(delivery.credentials).toBeUndefined();
  });

  it('puts the subject and body in the message, accents included', async () => {
    await new EmailAdapter().send({
      to: 'alice@example.org',
      subject: 'Soirée',
      body: 'Rendez-vous à 18h, salle B.',
    });

    const data = smtp.deliveries[0]?.data ?? '';
    const subject = /^Subject: (.*)$/m.exec(data)?.[1] ?? '';

    expect(decodeMimeWords(subject)).toBe('Soirée');
    expect(data).toContain('Rendez-vous');
  });

  it('authenticates when SMTP_USER is set', async () => {
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASSWORD = 's3cret';

    await new EmailAdapter().send({ to: 'alice@example.org', subject: 'Hello', body: 'Body' });

    expect(smtp.deliveries[0]?.credentials).toEqual({ user: 'mailer', password: 's3cret' });
  });

  it('sends one message per call, to that recipient only', async () => {
    const adapter = new EmailAdapter();
    await adapter.send({ to: 'alice@example.org', subject: 'Hello', body: 'Body' });
    await adapter.send({ to: 'bob@example.org', subject: 'Hello', body: 'Body' });

    expect(smtp.deliveries.map((delivery) => delivery.rcptTo)).toEqual([
      ['alice@example.org'],
      ['bob@example.org'],
    ]);
  });

  describe('sendMany', () => {
    const batch = (...recipients: string[]) =>
      recipients.map((to) => ({ to, subject: 'Hello', body: 'Body' }));

    it('delivers every message over one SMTP connection, not one per recipient', async () => {
      const outcomes = await new EmailAdapter().sendMany(
        batch('alice@example.org', 'bob@example.org', 'carol@example.org'),
      );

      expect(outcomes).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
      expect(smtp.deliveries.map((delivery) => delivery.rcptTo)).toEqual([
        ['alice@example.org'],
        ['bob@example.org'],
        ['carol@example.org'],
      ]);
      expect(smtp.connections()).toBe(1);
    });

    it('keeps going when one address is refused, and says which one failed', async () => {
      const outcomes = await new EmailAdapter().sendMany(
        batch('alice@example.org', 'bad@example.org', 'carol@example.org'),
      );

      expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
      expect(smtp.deliveries.map((delivery) => delivery.rcptTo[0])).toEqual([
        'alice@example.org',
        'carol@example.org',
      ]);
      // A refused address makes nodemailer open a fresh connection once: still not one per recipient.
      expect(smtp.connections()).toBeLessThanOrEqual(2);
    });

    it('does not connect at all for an empty batch or a batch of unusable messages', async () => {
      await expect(new EmailAdapter().sendMany([])).resolves.toEqual([]);
      const outcomes = await new EmailAdapter().sendMany([{ subject: 'Hello', body: 'Body' }]);

      expect(outcomes[0]).toMatchObject({ ok: false });
      expect(smtp.connections()).toBe(0);
    });

    it('reports the missing settings for every message instead of throwing', async () => {
      delete process.env.SMTP_HOST;

      const outcomes = await new EmailAdapter().sendMany(batch('a@example.org', 'b@example.org'));

      expect(outcomes).toHaveLength(2);
      for (const outcome of outcomes) {
        expect(outcome).toMatchObject({ ok: false });
        expect(String((outcome as { error: unknown }).error)).toContain('SMTP_HOST');
      }
    });

    it('lets the process end: the connection is closed after the batch', async () => {
      await new EmailAdapter().sendMany(batch('alice@example.org', 'bob@example.org'));

      // A pooled transport left open would hold the connection (and the test run) open.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await expect(smtp.close()).resolves.toBeUndefined();
      smtp = await startSmtpServer(); // reopen for afterEach
    });
  });

  it('refuses a message without a recipient, before connecting', async () => {
    await expect(new EmailAdapter().send({ subject: 'Hello', body: 'Body' })).rejects.toThrow(
      'message.to is required',
    );
    expect(smtp.deliveries).toHaveLength(0);
  });

  it('explains which variables are missing when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;

    await expect(
      new EmailAdapter().send({ to: 'alice@example.org', subject: 'Hello', body: 'Body' }),
    ).rejects.toThrow('SMTP_HOST, SMTP_PORT and SMTP_FROM');
  });

  it('rejects when the SMTP server cannot be reached, so callers can log the failure', async () => {
    await smtp.close();
    // Port of the server that was just closed: nothing listens there any more.
    await expect(
      new EmailAdapter().send({ to: 'alice@example.org', subject: 'Hello', body: 'Body' }),
    ).rejects.toThrow();
    // Reopen so afterEach can close it without error.
    smtp = await startSmtpServer();
  });
});
