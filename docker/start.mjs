// The command of the production image (`node /opt/start/start.mjs`): applies the database migrations,
// then starts the application. Plain JavaScript on purpose: the image has `node` and nothing else.
//
// It exists so that a problem the operator can fix is SEEN, not endured. Until now `sh -c "migrate && server"`
// simply exited, and the restart policy turned every wrong password or typo in .env into a silent loop
// whose only explanation sat in `docker compose logs`, half of it in English. Here:
//
//   - a failed migration is told apart (wrong password, database not there yet, bad address, other);
//   - the application tells it when its .env or bde.config.yml is unusable (exit code 78 + a small report);
//   - in both cases this process stays up and answers every request with a page that explains the problem
//     (FR/EN, 503, no secret), and /api/health with 503; a database that is not there yet is awaited and
//     the application starts by itself as soon as it answers;
//   - a real crash of the application still ends the container (with its exit code): that is what the
//     restart policy is for.
//
// It is also what makes an update safe (see "Updates" in docs/architecture.md): before the migrations it checks
// that the image and docker-compose.yml belong together and that the database is one this image can use, keeps a
// copy of the database when migrations are pending, and puts that copy back if they fail (docker/safe-update.mjs,
// docker/database-tools.mjs).
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as nodeCreateServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createDatabaseTools } from './database-tools.mjs';
import { ensureMasterSecrets } from './master-secrets.mjs';
import { checkStack } from './safe-update.mjs';
import {
  EXIT_CONFIG,
  RETRY_SECONDS,
  buildDatabaseUrl,
  classifyMigrationFailure,
  parseReport,
  pickLanguage,
  problemTitle,
  redact,
  renderProblemPage,
  terminalLine,
} from './startup-problems.mjs';

const MAX_OUTPUT = 64 * 1024;

/** Passes the output of a child on, line by line, through `rewrite` (which may drop a line by answering null). */
function forward(stream, sink, rewrite) {
  let pending = '';
  const write = (line) => {
    const out = rewrite(line);
    if (out !== null) sink.write(`${out}\n`);
  };
  stream.on('data', (chunk) => {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) write(line);
  });
  stream.on('end', () => {
    if (pending) write(pending);
    pending = '';
  });
}

/**
 * Runs a command to its end; resolves with its exit code and what it printed (both streams, capped).
 * `inherit`: it prints straight to this terminal; with `rewrite` as well, line by line through it.
 */
function run(spawn, { command, args, cwd, env, inherit = false, rewrite }, onChild) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: rewrite
        ? ['inherit', 'pipe', 'pipe']
        : inherit
          ? 'inherit'
          : ['ignore', 'pipe', 'pipe'],
    });
    onChild?.(child);
    const collect = (chunk) => {
      output = (output + chunk).slice(-MAX_OUTPUT);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    if (rewrite) {
      forward(child.stdout, process.stdout, rewrite);
      forward(child.stderr, process.stderr, rewrite);
    }
    child.on('error', (error) => resolve({ code: 1, output: `${output}\n${error.message}` }));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), output }));
  });
}

/**
 * Applies the migrations, then runs the application; see the top of the file for what happens when
 * either cannot. Resolves with the exit code of the container. Everything it touches is passed in, so
 * that the tests drive it with small scripts instead of Prisma and Next.js.
 */
export async function supervise({
  env,
  migrate,
  server,
  port,
  hostname = '0.0.0.0',
  reportPath,
  retryMs = RETRY_SECONDS * 1000,
  spawn = nodeSpawn,
  createServer = nodeCreateServer,
  log = (line) => console.log(line),
  signals = process,
  /** What makes an update safe: `{ stack(), tools, skipBackup, version }`. Absent: migrations run as they are. */
  safety = null,
}) {
  let stopping = false;
  let child = null;
  let page = null; // the server of the explanation page, while there is a problem
  let problem = null;
  let retrying = false;
  let wake = null; // interrupts the wait between two attempts
  let stop = () => {};
  const stopped = new Promise((resolve) => {
    stop = resolve;
  });

  const onSignal = () => {
    stopping = true;
    child?.kill('SIGTERM');
    wake?.();
    stop();
  };
  signals.on('SIGTERM', onSignal);
  signals.on('SIGINT', onSignal);

  const handle = (request, response) => {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Retry-After': String(RETRY_SECONDS),
    };
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/api/health') {
      response.writeHead(503, { ...headers, 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : '{"status":"blocked"}');
      return;
    }
    const lang = pickLanguage(request.url, request.headers['accept-language']);
    response.writeHead(503, {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Robots-Tag': 'noindex',
    });
    response.end(
      request.method === 'HEAD' ? undefined : renderProblemPage(problem, lang, retrying),
    );
  };

  /** Starts answering on the port, waiting a moment if the application that just left still holds it. */
  const showPage = async () => {
    if (page) return;
    const instance = createServer(handle);
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          instance.once('error', reject);
          instance.listen(port, hostname, () => {
            instance.removeListener('error', reject);
            resolve();
          });
        });
        page = instance;
        return;
      } catch (error) {
        if (error?.code !== 'EADDRINUSE' || attempt >= 50 || stopping) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  };

  const hidePage = async () => {
    if (!page) return;
    const instance = page;
    page = null;
    instance.closeAllConnections?.();
    await new Promise((resolve) => instance.close(resolve));
  };

  /** Tells the operator, once per problem, in the logs too. */
  const announce = (details) => {
    log('');
    log(`⚠️  La plateforme ne démarre pas : ${problemTitle(problem.kind, 'fr')}.`);
    log("    Une page qui explique quoi faire est affichée à l'adresse du site.");
    if (details) log(details);
    log('');
  };

  /** Stops here with a page that explains `next`, until the container is stopped (the operator fixes, restarts). */
  const stay = async (next, details = '') => {
    problem = next;
    retrying = false;
    announce(details);
    await showPage();
    await stopped;
    return 0;
  };

  // The copy made for the migrations that are pending, by the names of those migrations: asking again (a
  // database that is slow to answer) must not make a second one.
  const copies = new Map();

  try {
    for (;;) {
      let copy = null;
      let before = null;
      if (safety) {
        const stack = safety.stack();
        if (stack) return await stay({ ...stack, version: safety.version });
        if (!safety.tools.hasAddress()) return await stay({ kind: 'database-url', code: '' });

        before = await safety.tools.inspect();
        if (before.state === 'newer') {
          return await stay({
            kind: 'database-newer',
            migrations: before.unknown,
            version: safety.version,
          });
        }
        if (before.state === 'stuck') {
          return await stay({
            kind: 'migration-stuck',
            migrations: before.failed,
            backup: safety.tools.latestBackup() ?? '',
            version: safety.version,
          });
        }
        if (before.state === 'pending' && !safety.skipBackup) {
          const key = before.pending.join(',');
          copy = copies.get(key) ?? null;
          if (!copy) {
            log(
              `Mise à jour de la base de données : copie de sécurité avant d'appliquer ${before.pending.length} migration(s)...`,
            );
            try {
              copy = await safety.tools.backup();
              copies.set(key, copy);
              log(`  copie faite : ${copy} (volume « backups »)`);
            } catch (error) {
              return await stay(
                { kind: 'backup-failed', code: '', version: safety.version },
                redact(String(error?.message ?? error), env),
              );
            }
          }
        }
      }

      // Nothing to apply: the command of Prisma would only say so, after the time it takes to start its tool (about a second).
      // Every other state, and a database that could not be asked, still goes through it.
      const migration =
        safety && before?.state === 'current'
          ? { code: 0, output: 'Aucune migration à appliquer : la base de données est à jour.' }
          : await run(spawn, migrate);
      if (stopping) return 0;

      if (migration.code === 0) {
        log(redact(migration.output, env).trim());
        if (safety) {
          try {
            safety.tools.prune();
          } catch {
            /* an old copy that stays is not worth failing for */
          }
        }
        await hidePage();
        rmSync(reportPath, { force: true });
        const outcome = await run(spawn, server, (started) => {
          child = started;
        });
        child = null;
        if (stopping) return 0;
        if (outcome.code !== EXIT_CONFIG) return outcome.code;

        // The application refused to start: its own message is above in the logs, the report says which.
        let report = null;
        try {
          report = parseReport(readFileSync(reportPath, 'utf8'));
        } catch {
          /* no report: treated as a .env problem below */
        }
        problem = report ?? { kind: 'env', code: '', retry: false, variables: [] };
        retrying = false;
        announce('');
        await showPage();
        await stopped;
        return 0;
      }

      const failure = classifyMigrationFailure(migration.output);

      // A migration that really failed (not a database that is slow or refuses a password: those are waited for)
      // may have changed part of the database. The copy made just before is put back, and the result is checked.
      if (copy && failure.kind === 'migration') {
        const details = redact(migration.output, env).trim().split('\n').slice(-12).join('\n');
        log("La mise à jour de la base a échoué : remise de la base dans son état d'avant...");
        try {
          await safety.tools.restore(copy);
          const after = await safety.tools.inspect();
          const same =
            after.state === before.state && after.pending.join(',') === before.pending.join(',');
          if (!same) throw new Error('the database is not in the state it was in');
          copies.delete(before.pending.join(','));
          log('  la base est revenue exactement comme avant.');
          return await stay(
            {
              kind: 'migration-restored',
              code: failure.code,
              backup: copy,
              version: safety.version,
            },
            details,
          );
        } catch (error) {
          return await stay(
            {
              kind: 'migration-restore-failed',
              code: failure.code,
              backup: copy,
              version: safety.version,
            },
            `${details}\n${redact(String(error?.message ?? error), env)}`,
          );
        }
      }

      const changed = problem?.kind !== failure.kind;
      problem = { ...failure, variables: [] };
      retrying = failure.retry;
      if (changed) {
        announce(redact(migration.output, env).trim().split('\n').slice(-12).join('\n'));
      }
      await showPage();
      if (!failure.retry) {
        await stopped;
        return 0;
      }
      await Promise.race([
        new Promise((resolve) => {
          const timer = setTimeout(resolve, retryMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        }),
        stopped,
      ]);
      wake = null;
      if (stopping) return 0;
    }
  } finally {
    signals.removeListener('SIGTERM', onSignal);
    signals.removeListener('SIGINT', onSignal);
    await hidePage();
  }
}

/** Wires the real commands of the image. */
async function main() {
  const env = { ...process.env };

  // The keys the platform needs before it can be configured, kept in the `secrets` volume.
  const secrets = ensureMasterSecrets({ env });
  for (const warning of secrets.warnings)
    console.warn(`
⚠️  ${warning}
`);
  env.AUTH_SECRET = secrets.authSecret;
  if (secrets.settingsKey) env.SETTINGS_KEY = secrets.settingsKey;
  else delete env.SETTINGS_KEY;
  env.POSTGRES_USER ||= 'bde';
  env.POSTGRES_DB ||= 'bde_network';
  if (secrets.postgresPassword) env.POSTGRES_PASSWORD = secrets.postgresPassword;

  env.DATABASE_URL = env.DATABASE_URL?.trim() || buildDatabaseUrl(env);
  // The version of this image, written when it was built (see the Dockerfile): the application shows it, the
  // copies made before an update carry it.
  try {
    env.BDE_VERSION = readFileSync('/opt/start/version', 'utf8').trim() || 'unknown';
  } catch {
    env.BDE_VERSION ||= 'unknown';
  }
  const reportPath = env.BDE_STARTUP_REPORT || '/tmp/bde-startup-report.json';
  env.BDE_STARTUP_REPORT = reportPath;

  // The child processes print for themselves (their messages stay in the logs), except Prisma, whose
  // output is captured and printed through `redact` only when it fails, and the application's start-up
  // banner, whose addresses are those of the container and are replaced by the one to open (terminalLine).
  const hostPort = env.BDE_HOST_PORT?.trim() || String(Number(env.PORT || 3000));
  const code = await supervise({
    env,
    port: Number(env.PORT || 3000),
    hostname: env.HOSTNAME || '0.0.0.0',
    reportPath,
    safety: {
      stack: () => checkStack(env),
      tools: createDatabaseTools({ env }),
      skipBackup: env.BDE_SKIP_BACKUP === '1',
      version: env.BDE_VERSION,
    },
    migrate: {
      command: process.execPath,
      args: [
        '/opt/migrate/node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        '/opt/migrate/prisma.config.mjs',
      ],
      cwd: '/app',
      env,
    },
    server: {
      command: process.execPath,
      args: ['server.js'],
      cwd: '/app',
      env,
      inherit: true,
      rewrite: (line) => terminalLine(line, hostPort),
    },
  });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
