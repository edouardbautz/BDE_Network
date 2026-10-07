// @vitest-environment node
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supervise } from './start.mjs';

/** A command that runs a few lines of JavaScript: stands for Prisma, or for the application. */
const script = (code: string) => ({
  command: process.execPath,
  args: ['-e', code],
  cwd: tmpdir(),
  env: process.env,
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const until = async (check: () => Promise<boolean> | boolean, what: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe('supervise', () => {
  let dir: string;
  let port: number;
  let signals: EventEmitter;
  let lines: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bde-start-'));
    port = await freePort();
    signals = new EventEmitter();
    lines = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const start = (options: Record<string, unknown>): Promise<number> =>
    (supervise as unknown as (options: Record<string, unknown>) => Promise<number>)({
      env: {},
      port,
      hostname: '127.0.0.1',
      reportPath: join(dir, 'report.json'),
      retryMs: 50,
      log: (line: string) => lines.push(line),
      signals,
      migrate: script('process.exit(0)'),
      server: script('process.exit(0)'),
      ...options,
    });

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const serving = async () => {
    try {
      await get('/');
      return true;
    } catch {
      return false;
    }
  };

  it('starts the application once the migrations are applied, and ends with its exit code', async () => {
    expect(await start({})).toBe(0);
    expect(await start({ server: script('process.exit(3)') })).toBe(3);
  });

  it('does not hide a real crash of the application behind an explanation page', async () => {
    const code = await start({ server: script('console.error("boom"); process.exit(1)') });
    expect(code).toBe(1);
    expect(await serving()).toBe(false);
  });

  describe('when the migrations fail', () => {
    const failWith = (message: string) =>
      script(`console.error(${JSON.stringify(message)}); process.exit(1)`);

    it('explains a refused password, in French and in English, without a secret', async () => {
      const env = { POSTGRES_PASSWORD: 'hunter2-secret' };
      const done = start({
        env,
        migrate: failWith(
          'Error: P1000: Authentication failed, password hunter2-secret was refused',
        ),
        retryMs: 60_000,
      });
      await until(serving, 'the page');

      const fr = await get('/', { 'Accept-Language': 'fr-FR' });
      expect(fr.status).toBe(503);
      expect(fr.headers.get('content-type')).toContain('text/html');
      expect(fr.headers.get('cache-control')).toBe('no-store');
      const frHtml = await fr.text();
      expect(frHtml).toContain('La base de données refuse la connexion');
      expect(frHtml).toContain('<code>P1000</code>');
      expect(frHtml).not.toContain('hunter2');

      const en = await (await get('/anything?x=1', { 'Accept-Language': 'en' })).text();
      expect(en).toContain('The database refuses the connection');

      signals.emit('SIGTERM');
      expect(await done).toBe(0);

      expect(lines.join('\n')).toContain('La base de données refuse la connexion');
      expect(lines.join('\n')).not.toContain('hunter2');
      expect(lines.join('\n')).toContain('***');
    });

    it('answers the health check with 503, so the container shows as unhealthy', async () => {
      const done = start({ migrate: failWith('Error: P3009'), retryMs: 60_000 });
      await until(serving, 'the page');
      const health = await get('/api/health');
      expect(health.status).toBe(503);
      expect(await health.json()).toEqual({ status: 'blocked' });
      signals.emit('SIGINT');
      expect(await done).toBe(0);
    });

    it('does not try again a problem that waiting cannot fix', async () => {
      const counter = join(dir, 'attempts');
      const done = start({
        migrate: script(
          `const fs=require('fs');const f=${JSON.stringify(counter)};` +
            `fs.appendFileSync(f,'x');console.error('Error: P3009');process.exit(1)`,
        ),
        retryMs: 20,
      });
      await until(serving, 'the page');
      await new Promise((resolve) => setTimeout(resolve, 300));
      signals.emit('SIGTERM');
      await done;
      expect(readFileSync(counter, 'utf8')).toBe('x');
      expect(lines.join('\n')).toContain('La mise à jour de la base de données a échoué');
    });

    it('waits for a database that is not there yet and starts by itself when it answers', async () => {
      const counter = join(dir, 'attempts');
      const done = start({
        // fails twice, then succeeds
        migrate: script(
          `const fs=require('fs');const f=${JSON.stringify(counter)};` +
            `fs.appendFileSync(f,'x');` +
            `if(fs.readFileSync(f,'utf8').length<3){console.error("Error: P1001: Can't reach database server");process.exit(1)}`,
        ),
        // the application: serves nothing, ends right away
        server: script('process.exit(0)'),
        retryMs: 150,
      });

      await until(serving, 'the waiting page');
      const page = await (await get('/')).text();
      expect(page).toContain('La base de données ne répond pas');
      expect(page).toContain('http-equiv="refresh"'); // the browser asks again by itself

      expect(await done).toBe(0);
      expect(readFileSync(counter, 'utf8').length).toBe(3);
      // told once, not at every attempt
      expect(lines.filter((line) => line.includes('ne démarre pas'))).toHaveLength(1);
    });

    it('gives the port back to the application when the database comes back', async () => {
      const counter = join(dir, 'attempts');
      const answers = join(dir, 'application-answered');
      const done = start({
        migrate: script(
          `const fs=require('fs');const f=${JSON.stringify(counter)};fs.appendFileSync(f,'x');` +
            `if(fs.readFileSync(f,'utf8').length<2){console.error("Error: P1001");process.exit(1)}`,
        ),
        // the real application listens on the same port
        server: script(
          `const http=require('http');http.createServer((q,r)=>r.end('the application'))` +
            `.listen(${port},'127.0.0.1',()=>require('fs').writeFileSync(${JSON.stringify(answers)},'1'))`,
        ),
        retryMs: 100,
      });

      await until(() => existsSync(answers), 'the application to listen');
      expect(await (await get('/')).text()).toBe('the application');
      signals.emit('SIGTERM');
      expect(await done).toBe(0);
    });
  });

  describe('when the application refuses its configuration (exit code 78)', () => {
    const refuse = script('process.exit(78)');

    it('explains which settings, from the report the application left', async () => {
      const reportPath = join(dir, 'report.json');
      const done = start({
        reportPath,
        server: script(
          `require('fs').writeFileSync(${JSON.stringify(reportPath)},` +
            `JSON.stringify({kind:'env',variables:['AUTH_SECRET','FORTYTWO_CLIENT_ID']}));process.exit(78)`,
        ),
      });
      await until(serving, 'the page');
      const html = await (await get('/', { 'Accept-Language': 'en' })).text();
      expect(html).toContain('A setting in the .env file needs fixing');
      expect(html).toContain('<code>AUTH_SECRET</code>, <code>FORTYTWO_CLIENT_ID</code>');
      expect(html).not.toContain('http-equiv="refresh"'); // nothing will fix itself
      signals.emit('SIGTERM');
      expect(await done).toBe(0);
    });

    it('still explains it when the report is missing or unreadable', async () => {
      const done = start({ server: refuse });
      await until(serving, 'the page');
      expect(await (await get('/')).text()).toContain('Un réglage du fichier .env est à corriger');
      writeFileSync(join(dir, 'unused'), '');
      signals.emit('SIGTERM');
      expect(await done).toBe(0);
    });

    it('says a bde.config.yml problem is one', async () => {
      const reportPath = join(dir, 'report.json');
      const done = start({
        reportPath,
        server: script(
          `require('fs').writeFileSync(${JSON.stringify(reportPath)},'{"kind":"config"}');process.exit(78)`,
        ),
      });
      await until(serving, 'the page');
      expect(await (await get('/')).text()).toContain('Le fichier bde.config.yml est à corriger');
      signals.emit('SIGTERM');
      await done;
    });

    it('ignores a report left by an earlier run', async () => {
      const reportPath = join(dir, 'report.json');
      writeFileSync(reportPath, '{"kind":"config"}');
      const done = start({ reportPath, server: refuse });
      await until(serving, 'the page');
      expect(await (await get('/')).text()).toContain('Un réglage du fichier .env');
      signals.emit('SIGTERM');
      await done;
    });
  });

  it('passes a stop request to the application and ends cleanly', async () => {
    const listening = join(dir, 'listening');
    const done = start({
      server: script(
        `process.on('SIGTERM',()=>process.exit(0));require('fs').writeFileSync(${JSON.stringify(listening)},'1');setInterval(()=>{},1000)`,
      ),
    });
    await until(() => existsSync(listening), 'the application to run');
    signals.emit('SIGTERM');
    expect(await done).toBe(0);
  });
});
