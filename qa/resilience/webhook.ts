import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAction, locate, readManifest } from '../access/actions-run';
import { withDatabase, type Platform } from '../access/http';
import { resetDatabase } from '../reset';
import type { Report } from '../security/core';
import { ask, EVENTS, isServed } from './context';
import { APP, docker, healthStatus, sleep, waitUntil } from './docker';
import { heldFor, parseHangLog } from './judge';

/**
 * The channel the notifications go to (a Discord or Slack webhook) is deaf: it takes the connection, completes the handshake and
 * never answers, and then it is gone. A notification is best effort and after the response, so the platform must not notice: the
 * action that caused it answers at once, the pages keep serving, the connection is given up after a while (a hung one holds a
 * socket and a task for ever), and the failure is in the logs without the address of the webhook (on a real one, the address is
 * the secret).
 *
 * The platform is made with `sh qa/platform.sh up --webhook https://qa-hang:8443/hook`.
 */

const AREA = 'webhook';
export const HANG = 'qa-hang';
export const HANG_ADDRESS = 'https://qa-hang:8443/hook';

/**
 * A server with a certificate nobody signed that accepts every connection, reads the request and never answers, and logs when
 * each connection opened and closed. A plain socket would do for the handshake to hang, but the platform's HTTP client gives up
 * on a handshake by itself: the case that matters is a server that is there and says nothing.
 */
const HANG_SCRIPT = `
const https = require('https');
const fs = require('fs');
let n = 0;
const server = https.createServer(
  { key: fs.readFileSync('/hang/key.pem'), cert: fs.readFileSync('/hang/cert.pem') },
  (request) => { request.on('data', () => {}); },
);
server.headersTimeout = 0;
server.requestTimeout = 0;
server.on('secureConnection', (socket) => {
  const id = ++n;
  console.log('open ' + id + ' ' + Date.now());
  socket.on('error', () => {});
  socket.on('close', () => console.log('close ' + id + ' ' + Date.now()));
});
server.listen(8443, () => console.log('listening'));
`;

const hangLog = () => docker('logs', HANG).out;

/** Starts the deaf server on the platform's network. The certificate is made here (the images have no `openssl`) and copied in. */
function startHang(): { ok: boolean; detail: string } {
  const dir = mkdtempSync(join(tmpdir(), 'qa-hang-'));
  const made = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=qa-hang',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { encoding: 'utf8' },
  );
  if (made.status !== 0)
    return { ok: false, detail: `openssl is needed on this machine: ${made.stderr}` };
  writeFileSync(join(dir, 'hang.js'), HANG_SCRIPT);

  docker('rm', '-f', HANG);
  const image = process.env.QA_IMAGE ?? 'bde-network';
  const created = docker(
    'create',
    '--name',
    HANG,
    '--network',
    process.env.QA_NETWORK ?? 'qa-net',
    '--entrypoint',
    'node',
    image,
    '/hang/hang.js',
  );
  if (!created.ok) return { ok: false, detail: created.out };
  const copied = docker('cp', `${dir}/.`, `${HANG}:/hang`);
  if (!copied.ok) return { ok: false, detail: copied.out };
  const started = docker('start', HANG);
  return { ok: started.ok, detail: started.out.slice(0, 200) };
}

export async function checkWebhook(platform: Platform, report: Report): Promise<void> {
  report.watch('the address of the webhook', HANG_ADDRESS);
  const healthy = report.check(
    AREA,
    'the platform is healthy, made with the webhook (the checks below mean something)',
    (await healthStatus(platform)) === 200,
    'start it with: sh qa/platform.sh up --webhook https://qa-hang:8443/hook',
  );
  if (!healthy) return;
  const started = startHang();
  report.check(AREA, 'the server that never answers is up', started.ok, started.detail);
  if (!started.ok) return;
  await waitUntil(async () => /listening/.test(hangLog()), { seconds: 20 });

  const manifest = readManifest();
  const { id, page } = locate(manifest, 'events.setEventStatus');
  const setStatus = (event: string, status: string) =>
    callAction(platform, 'validator', id, page, [event, status]);

  await withDatabase(platform, (db) => resetDatabase(db));

  // 1. The action that causes a notification answers at once, although the channel never will.
  const startedAt = performance.now();
  const approved = await setStatus(EVENTS.proposed, 'CONFIRMED');
  const took = performance.now() - startedAt;
  report.check(
    AREA,
    'approving a proposal answers in less than 5 s although the webhook never answers',
    !approved.threw && took < 5_000,
    `${approved.status} in ${Math.round(took)} ms`,
  );

  // 2. The notification was really tried (otherwise the rest proves nothing).
  const tried = await waitUntil(async () => parseHangLog(hangLog()).length > 0, { seconds: 30 });
  report.check(
    AREA,
    'the platform did try to reach the webhook (the notification is wired)',
    tried !== null,
    tried === null ? 'no connection in 30 s' : `after ${Math.round(tried)} ms`,
  );

  // 3. Meanwhile it serves.
  const health = await healthStatus(platform, 8_000);
  const page1 = await ask(platform, '/fr/dashboard', { as: 'member', timeoutMs: 10_000 });
  report.check(
    AREA,
    'while a connection to the webhook hangs, the platform serves pages',
    health === 200 && isServed(page1) && page1.ms < 5_000,
    `health ${health}, dashboard ${page1.status} in ${Math.round(page1.ms)} ms`,
  );
  const second = performance.now();
  const published = await setStatus(EVENTS.draft, 'CONFIRMED');
  report.check(
    AREA,
    'a second action, with the first notification still hanging, answers in less than 5 s',
    !published.threw && performance.now() - second < 5_000,
    `${published.status} in ${Math.round(performance.now() - second)} ms`,
  );

  // 4. The hung connection is given up. (Node's own limit is five minutes: a socket and a task held that long for a message
  //    nobody will read.)
  const given = await waitUntil(
    async () => {
      const connections = parseHangLog(hangLog());
      return (
        connections.length > 0 && connections.every((connection) => connection.closedAt !== null)
      );
    },
    { seconds: 60, everyMs: 2_000 },
  );
  const connections = parseHangLog(hangLog());
  const latest = Math.max(0, ...connections.map((c) => Math.max(c.openedAt, c.closedAt ?? 0)));
  const held = heldFor(connections, latest);
  const longest = Math.round(Math.max(0, ...held) / 1000);
  report.check(
    AREA,
    'the platform gives up on a webhook that never answers within a minute',
    given !== null,
    connections.length === 0
      ? 'no connection to judge'
      : given === null
        ? `still held after 60 s (${connections.length} connection(s), the longest ${longest} s so far)`
        : `closed after ${longest} s at most`,
  );

  // 5. The channel is gone: the same.
  docker('stop', '-t', '1', HANG);
  await withDatabase(platform, (db) => resetDatabase(db));
  const gone = performance.now();
  const third = await setStatus(EVENTS.proposed, 'CONFIRMED');
  report.check(
    AREA,
    'with the webhook gone, an action still answers in less than 5 s',
    !third.threw && performance.now() - gone < 5_000,
    `${third.status} in ${Math.round(performance.now() - gone)} ms`,
  );
  await sleep(4_000);
  const logs = docker('logs', APP).out;
  report.check(
    AREA,
    'the address of the webhook is not in the logs',
    !logs.includes('/hook') && !logs.includes(HANG_ADDRESS),
    logs.includes('/hook') ? 'the address of the webhook is in the logs' : 'not found in the logs',
  );
  report.check(
    AREA,
    'the platform is still healthy afterwards',
    (await healthStatus(platform)) === 200,
  );
  docker('rm', '-f', HANG);
}
