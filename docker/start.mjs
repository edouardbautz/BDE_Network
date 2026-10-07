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
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as nodeCreateServer } from 'node:http';
import { pathToFileURL } from 'node:url';
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
} from './startup-problems.mjs';

const MAX_OUTPUT = 64 * 1024;

/** Runs a command to its end; resolves with its exit code and what it printed (both streams, capped). */
function run(spawn, { command, args, cwd, env, inherit = false }, onChild) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    onChild?.(child);
    const collect = (chunk) => {
      output = (output + chunk).slice(-MAX_OUTPUT);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
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

  try {
    for (;;) {
      const migration = await run(spawn, migrate);
      if (stopping) return 0;

      if (migration.code === 0) {
        log(redact(migration.output, env).trim());
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
        await showPage();
        await stopped;
        return 0;
      }

      const failure = classifyMigrationFailure(migration.output);
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
  env.DATABASE_URL = env.DATABASE_URL?.trim() || buildDatabaseUrl(env);
  const reportPath = env.BDE_STARTUP_REPORT || '/tmp/bde-startup-report.json';
  env.BDE_STARTUP_REPORT = reportPath;

  // The child processes print for themselves (their messages stay in the logs), except Prisma, whose
  // output is captured and printed through `redact` only when it fails.
  const code = await supervise({
    env,
    port: Number(env.PORT || 3000),
    hostname: env.HOSTNAME || '0.0.0.0',
    reportPath,
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
    server: { command: process.execPath, args: ['server.js'], cwd: '/app', env, inherit: true },
  });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
