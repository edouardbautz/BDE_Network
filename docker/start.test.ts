// @vitest-environment node
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('passes the output of the application on through `rewrite`, line by line, and can drop a line', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const code = await start({
        server: {
          ...script(
            'process.stdout.write("- Local: a\\n- Network: http://0.0.0.0:3000\\nlast line without newline")',
          ),
          inherit: true,
          rewrite: (line: string) => (line.includes('Network') ? null : line.toUpperCase()),
        },
      });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(written.join('')).toBe('- LOCAL: A\nLAST LINE WITHOUT NEWLINE\n');
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

  describe('an update that keeps a copy of the database', () => {
    const COPY = 'pre-update_20261015T101530Z_v1.1.0.sql.gz';
    const M = '20261015120000_event_series_scope';
    type State = { state: string; pending: string[]; unknown: string[]; failed: string[] };
    const pending: State = { state: 'pending', pending: [M], unknown: [], failed: [] };

    const failWith = (message: string) =>
      script(`console.error(${JSON.stringify(message)}); process.exit(1)`);

    /** What the start-up command asks of the database, by hand: every call can be looked at, and made to fail. */
    function tools(over: Record<string, unknown> = {}) {
      return {
        hasAddress: () => true,
        inspect: vi.fn(async () => pending),
        backup: vi.fn(async () => COPY),
        restore: vi.fn(async () => undefined),
        prune: vi.fn(),
        latestBackup: vi.fn(() => COPY),
        ...over,
      };
    }
    const safety = (db: ReturnType<typeof tools>, over: Record<string, unknown> = {}) => ({
      stack: () => null,
      skipBackup: false,
      version: '1.1.0',
      tools: db,
      ...over,
    });
    const pageText = async (lang = 'fr') =>
      (await (await get('/', { 'Accept-Language': lang })).text()).replaceAll('&#39;', "'");

    it('keeps a copy BEFORE the migrations that are pending are applied, then starts the application', async () => {
      const made = join(dir, 'copy-made');
      const db = tools({
        backup: vi.fn(async () => {
          writeFileSync(made, '1');
          return COPY;
        }),
      });
      // The migration only succeeds when the copy already exists.
      const code = await start({
        safety: safety(db),
        migrate: script(`process.exit(require('fs').existsSync(${JSON.stringify(made)}) ? 0 : 9)`),
      });
      expect(code).toBe(0);
      expect(db.backup).toHaveBeenCalledTimes(1);
      expect(db.restore).not.toHaveBeenCalled();
      expect(db.prune).toHaveBeenCalledTimes(1);
      expect(lines.join('\n')).toContain(COPY);
    });

    it.each(['current', 'fresh'])(
      'makes no copy when the database is %s: nothing is going to change',
      async (state) => {
        const db = tools({
          inspect: vi.fn(async () => ({ state, pending: [], unknown: [], failed: [] })),
        });
        expect(await start({ safety: safety(db) })).toBe(0);
        expect(db.backup).not.toHaveBeenCalled();
      },
    );

    describe('the command that applies the migrations', () => {
      const states = {
        current: { state: 'current', pending: [], unknown: [], failed: [] },
        fresh: { state: 'fresh', pending: [M], unknown: [], failed: [] },
        pending,
        unreachable: { state: 'unreachable', output: 'connection refused' },
      };

      it('is not started when everything is applied: Prisma would only say so', async () => {
        const marker = join(dir, 'migrate-ran');
        const db = tools({ inspect: vi.fn(async () => states.current) });
        const code = await start({
          safety: safety(db),
          migrate: script(`require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`),
        });
        expect(code).toBe(0);
        expect(existsSync(marker)).toBe(false);
        expect(lines.join('\n')).toContain('à jour');
      });

      it.each(['fresh', 'pending', 'unreachable'] as const)(
        'is started when the database is %s',
        async (state) => {
          const marker = join(dir, `migrate-ran-${state}`);
          const db = tools({ inspect: vi.fn(async () => states[state]) });
          await start({
            safety: safety(db),
            migrate: script(`require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`),
          });
          expect(existsSync(marker)).toBe(true);
        },
      );

      it('is started when nothing could be checked (no safety at all: a plain docker run)', async () => {
        const marker = join(dir, 'migrate-ran-plain');
        await start({
          migrate: script(`require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`),
        });
        expect(existsSync(marker)).toBe(true);
      });
    });

    it('makes no copy when told to go on without one (BDE_SKIP_BACKUP)', async () => {
      const db = tools();
      expect(await start({ safety: safety(db, { skipBackup: true }) })).toBe(0);
      expect(db.backup).not.toHaveBeenCalled();
    });

    describe('when a migration fails', () => {
      it('puts the copy back, checks the database is as it was, and says so in both languages', async () => {
        const inspect = vi
          .fn()
          .mockResolvedValueOnce(pending) // before
          .mockResolvedValueOnce(pending); // after the restore: the same
        const db = tools({ inspect });
        const ran = join(dir, 'server-ran');
        const done = start({
          safety: safety(db),
          migrate: failWith(
            'Error: P3018 A migration failed to apply. relation "x" already exists',
          ),
          server: script(`require('fs').writeFileSync(${JSON.stringify(ran)},'1')`),
          retryMs: 60_000,
        });
        await until(serving, 'the page');

        expect(db.restore).toHaveBeenCalledWith(COPY);
        const fr = await pageText('fr');
        expect(fr).toContain('votre base a été remise comme avant');
        expect(fr).toContain(COPY);
        expect(fr).toContain('<code>P3018</code>');
        expect(await pageText('en')).toContain('your database was put back as it was');
        expect((await get('/api/health')).status).toBe(503);
        expect(existsSync(ran)).toBe(false); // the application never ran on that database

        signals.emit('SIGTERM');
        expect(await done).toBe(0);
        expect(lines.join('\n')).toContain('revenue exactement comme avant');
      });

      it('says the database could NOT be put back, and where the copy is, when the restore fails', async () => {
        const db = tools({
          restore: vi.fn(async () => {
            throw new Error('psql exited with 2');
          }),
        });
        const done = start({
          safety: safety(db),
          migrate: failWith('P3018 boom'),
          retryMs: 60_000,
        });
        await until(serving, 'the page');

        const html = await pageText();
        expect(html).toContain("n'a pas pu être remise comme avant");
        expect(html).toContain(COPY);
        expect(html).toContain('--pre-update');
        signals.emit('SIGTERM');
        await done;
      });

      it('does not trust a restore that left the database in another state than before', async () => {
        const db = tools({
          inspect: vi
            .fn()
            .mockResolvedValueOnce(pending)
            .mockResolvedValueOnce({ state: 'current', pending: [], unknown: [], failed: [] }),
        });
        const done = start({
          safety: safety(db),
          migrate: failWith('P3018 boom'),
          retryMs: 60_000,
        });
        await until(serving, 'the page');

        expect(await pageText()).toContain("n'a pas pu être remise comme avant");
        signals.emit('SIGTERM');
        await done;
      });

      it('does not restore for a database that is slow or refuses a password: those are waited for, nothing was changed', async () => {
        const db = tools();
        const done = start({
          safety: safety(db),
          migrate: failWith("Error: P1001: Can't reach database server"),
          retryMs: 60_000,
        });
        await until(serving, 'the page');

        expect(db.restore).not.toHaveBeenCalled();
        expect(await pageText()).toContain('La base de données ne répond pas');
        signals.emit('SIGTERM');
        await done;
      });

      it('makes one copy, not one per attempt, when the same migrations are tried again', async () => {
        const db = tools();
        const marker = join(dir, 'attempt');
        // First attempt: the database does not answer. Second: it does.
        const migrate = script(
          `const fs=require('fs');if(!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'1');console.error('P1001 cannot reach');process.exit(1)}process.exit(0)`,
        );
        expect(await start({ safety: safety(db), migrate, retryMs: 20 })).toBe(0);
        expect(db.backup).toHaveBeenCalledTimes(1);
      });
    });

    it('does not apply the migrations when the copy cannot be made, and says how to go on', async () => {
      const db = tools({
        backup: vi.fn(async () => {
          throw new Error('No space left on device');
        }),
      });
      const ran = join(dir, 'migrated');
      const done = start({
        safety: safety(db),
        migrate: script(`require('fs').writeFileSync(${JSON.stringify(ran)},'1')`),
        retryMs: 60_000,
      });
      await until(serving, 'the page');

      const html = await pageText();
      expect(html).toContain('La copie de sécurité avant mise à jour a échoué');
      expect(html).toContain('BDE_SKIP_BACKUP=1');
      expect(existsSync(ran)).toBe(false);
      signals.emit('SIGTERM');
      await done;
    });

    describe('when the stack does not fit', () => {
      const stays = async (over: Record<string, unknown>, db = tools()) => {
        const ran = join(dir, 'migrated');
        const done = start({
          safety: safety(db, over),
          migrate: script(`require('fs').writeFileSync(${JSON.stringify(ran)},'1')`),
          retryMs: 60_000,
        });
        await until(serving, 'the page');
        return {
          html: await pageText(),
          en: await pageText('en'),
          touched: existsSync(ran) || (db.backup as ReturnType<typeof vi.fn>).mock.calls.length > 0,
          stop: async () => {
            signals.emit('SIGTERM');
            await done;
          },
        };
      };

      it('explains a compose file older than the image, and touches nothing', async () => {
        const page = await stays({ stack: () => ({ kind: 'stack-old-compose' }) });
        expect(page.html).toContain("docker-compose.yml est plus ancien que l'image");
        expect(page.en).toContain('docker-compose.yml is older than the image');
        expect(page.touched).toBe(false);
        await page.stop();
      });

      it('explains an image older than the compose file: the old image kept after a git pull', async () => {
        const page = await stays({ stack: () => ({ kind: 'stack-old-image' }) });
        expect(page.html).toContain("L'image est plus ancienne que docker-compose.yml");
        expect(page.html).toContain('1.1.0'); // the version of the image that is running
        expect(page.touched).toBe(false);
        await page.stop();
      });

      it('explains a database address that cannot be built, instead of letting Prisma fail in a loop', async () => {
        const page = await stays({}, tools({ hasAddress: () => false }));
        expect(page.html).toContain("L'adresse de la base de données est invalide");
        expect(page.touched).toBe(false);
        await page.stop();
      });

      it('refuses a database that is newer than the image, names the migrations, and changes nothing', async () => {
        const future = '20270101000000_something_new';
        const page = await stays(
          {},
          tools({
            inspect: vi.fn(async () => ({
              state: 'newer',
              pending: [],
              unknown: [future],
              failed: [],
            })),
          }),
        );
        expect(page.html).toContain('La base de données est plus récente que cette version');
        expect(page.html).toContain(future);
        expect(page.touched).toBe(false);
        await page.stop();
      });

      it('refuses a database that an earlier failed migration left unfinished, and points to the copy', async () => {
        const page = await stays(
          {},
          tools({
            inspect: vi.fn(async () => ({ state: 'stuck', pending: [], unknown: [], failed: [M] })),
          }),
        );
        expect(page.html).toContain('est restée inachevée');
        expect(page.html).toContain(M);
        expect(page.html).toContain(COPY);
        expect(page.touched).toBe(false);
        await page.stop();
      });

      it('goes on to the migration, which classifies the failure, when the database cannot be asked yet', async () => {
        const db = tools({
          inspect: vi.fn(async () => ({ state: 'unreachable', output: 'connection refused' })),
        });
        expect(await start({ safety: safety(db) })).toBe(0);
        expect(db.backup).not.toHaveBeenCalled();
      });
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
