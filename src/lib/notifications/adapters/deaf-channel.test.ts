// @vitest-environment node
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from './discord';
import { EmailAdapter } from './email';
import { SlackAdapter } from './slack';

/**
 * A channel that accepts the connection and never answers (a webhook that hangs, a mail server that says nothing): the adapter
 * must give up by itself. The limits are shortened for the test; that they exist, and are small in production, is
 * `timeouts.test.ts`. Real servers on the loopback, so the adapters do their real work.
 */

vi.mock('../timeouts', () => ({
  WEBHOOK_TIMEOUT_MS: 400,
  SMTP_TIMEOUTS: { connectionTimeout: 400, greetingTimeout: 400, socketTimeout: 400 },
}));

const sockets = new Set<Socket>();
const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  );
}

function deafHttpServer(): Server {
  const server = createHttpServer((request) => {
    request.resume();
  });
  server.on('connection', (socket) => sockets.add(socket));
  return server;
}

function silentTcpServer(): Server {
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
  });
  return server;
}

beforeEach(() => {
  vi.stubEnv('SMTP_FROM', 'BDE Test <bde@example.org>');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const SMALL = { subject: 'Sujet', body: 'Corps' };

async function tookLessThan(ms: number, work: Promise<unknown>): Promise<'rejected' | 'resolved'> {
  const started = Date.now();
  const outcome = await work.then(
    () => 'resolved' as const,
    () => 'rejected' as const,
  );
  expect(Date.now() - started).toBeLessThan(ms);
  return outcome;
}

describe('a channel that never answers', () => {
  it('is given up on by the Discord adapter', async () => {
    const port = await listen(deafHttpServer());
    vi.stubEnv('DISCORD_WEBHOOK_URL', `http://127.0.0.1:${port}/hook`);
    expect(await tookLessThan(3_000, new DiscordAdapter().send(SMALL))).toBe('rejected');
  });

  it('is given up on by the Slack adapter', async () => {
    const port = await listen(deafHttpServer());
    vi.stubEnv('SLACK_WEBHOOK_URL', `http://127.0.0.1:${port}/hook`);
    expect(await tookLessThan(3_000, new SlackAdapter().send(SMALL))).toBe('rejected');
  });

  it('is given up on by the e-mail adapter, which says so for that message and goes on', async () => {
    const port = await listen(silentTcpServer());
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', String(port));
    const outcomes = await EmailAdapter.prototype.sendMany.call(new EmailAdapter(), [
      { ...SMALL, to: 'alice@example.org' },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ok).toBe(false);
  }, 5_000);
});
