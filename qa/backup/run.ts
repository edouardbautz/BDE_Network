import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkInvariants, describeViolations } from '../invariants';
import { tableCell } from '../markdown';
import { forgeSessionCookie, SESSION_COOKIE } from '../personas';
import { Report } from '../security/core';
import { PASSWORD, run, sleep, Stack } from '../upgrade/stack';

/**
 * The nightly backups, played the way an operator lives them: a platform started with `docker compose up -d` (the real compose file,
 * the real image), a BDE that has data, the clock of the platform set to ten past three in the morning, and nobody doing anything.
 *
 *   1. the platform makes its backup by itself, checks it by reading it again, and leaves nothing half made behind;
 *   2. `docker compose down -v` (every volume of the platform gone): the backup is still on the host;
 *   3. a server with nothing: the backup is put there, `scripts/restore.sh --auto` restores it, and the BDE is back: its data,
 *      its keys (the sessions of before still open, the sealed settings readable), as it was.
 *
 *   tsx qa/backup/run.ts [--report report.json]
 *
 * The image is built before (`docker build -t bde-network:local .`, the name of `docker-compose.build.yml`).
 */

const area = 'backups';
const OWNER = 'qa-owner';

const CONFIG = `bde:
  name: 'BDE QA'
  campus: 'Paris'
  timezone: 'Europe/Paris'
  defaultLocale: 'fr'
  accentColor: '#0f766e'
  logoPath: '/logo.svg'
auth:
  owners:
    - '${OWNER}'
  allowedCampuses: []
modules:
  enabled: [events]
events:
  categories:
    - { key: 'soiree', label: 'Soirée', color: '#db2777' }
    - { key: 'sport', label: 'Sport', color: '#16a34a' }
  reminderHour: 18
updates:
  check: false
`;

/** 03:10 on 2026-10-27 in Paris (UTC+1 since the clocks went back): ten minutes after the hour of the backup. */
const NIGHT = '2026-10-27T02:10:00Z';
/** Midday: the platform is loaded with its data while the hour of the backup is far away. */
const NOON = '2026-10-27T11:00:00Z';

const COUNTED = ['User', 'Role', 'Event', 'AuditLog', 'PlatformSettings'] as const;

function environmentOf(stack: Stack): void {
  // What an operator who never opened a configuration file has: no AUTH_SECRET (the platform makes its own keys, in the volume).
  writeFileSync(
    join(stack.dir, '.env'),
    [
      'POSTGRES_USER=bde',
      `POSTGRES_PASSWORD=${PASSWORD}`,
      'POSTGRES_DB=bde_network',
      'FORTYTWO_CLIENT_ID=qa-client',
      'FORTYTWO_CLIENT_SECRET=qa-client-secret',
      `APP_URL=http://localhost:${stack.port}`,
      'APP_BIND=127.0.0.1',
      `APP_PORT=${stack.port}`,
      'FORTYTWO_API_URL=http://127.0.0.1:9',
      '',
    ].join('\n'),
  );
}

/** A folder like the one an operator has: the compose files and the scripts, nothing built. */
function folder(project: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-backup-'));
  for (const name of ['docker-compose.yml', 'docker-compose.build.yml']) {
    copyFileSync(join(project, name), join(dir, name));
  }
  mkdirSync(join(dir, 'scripts'));
  for (const name of ['backup.sh', 'restore.sh']) {
    copyFileSync(join(project, 'scripts', name), join(dir, 'scripts', name));
  }
  return dir;
}

function prepare(stack: Stack, now: string, project: string): void {
  environmentOf(stack);
  stack.prepare({
    mountsConfig: true,
    build: true,
    app: {
      volumes: [
        `${resolve(project, 'qa', 'fake-clock.cjs').split('\\').join('/')}:/qa/fake-clock.cjs:ro`,
      ],
      environment: {
        BDE_QA_NOW: now,
        NODE_OPTIONS:
          '--require=/qa/fake-clock.cjs --max-old-space-size=384 --max-semi-space-size=32',
      },
    },
  });
  writeFileSync(join(stack.dir, 'bde.config.yml'), CONFIG);
}

const inApp = (stack: Stack, ...command: string[]) =>
  stack.compose('exec', '-T', 'app', ...command);

async function facts(stack: Stack) {
  return stack.database(async (db) => {
    const counts: Record<string, number> = {};
    for (const table of COUNTED) {
      counts[table] = Number((await db.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0]?.n);
    }
    const scratch = (
      await db.query(`SELECT datname FROM pg_database WHERE datname LIKE 'bde_verify_%'`)
    ).rows;
    const violations = await checkInvariants(db);
    return { counts, scratch: scratch.length, violations };
  });
}

async function pageAs(stack: Stack, path: string, secret: string) {
  const cookie = `${SESSION_COOKIE}=${await forgeSessionCookie(OWNER, secret)}`;
  const response = await fetch(`${stack.base}${path}`, {
    redirect: 'manual',
    headers: { cookie },
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    body: await response.text(),
  };
}

const shown = (answer: { status: number; location: string | null; body: string }) =>
  answer.status === 200 &&
  !answer.location &&
  !/__next-page-redirect|NEXT_HTTP_ERROR_FALLBACK/.test(answer.body);

export async function playBackups(report: Report): Promise<void> {
  const check = (name: string, ok: boolean, detail = '') => report.check(area, name, ok, detail);
  const project = run('git', ['rev-parse', '--show-toplevel']).out;
  const answers = async (stack: Stack, name: string) => {
    const took = await stack.healthy(300);
    check(
      name,
      took !== null,
      took === null ? stack.logs(30).slice(-600) : `${Math.round(took)} ms`,
    );
  };
  const dirA = folder(project);
  const dirB = folder(project);
  const a = new Stack(dirA, 'qabak-a', 3300, 55460);
  const b = new Stack(dirB, 'qabak-b', 3301, 55461);

  try {
    // ---- 1. a platform with data, left alone at the hour of the backup ---------------------------------------------------------
    prepare(a, NOON, project);
    const started = a.up({ build: false });
    check(
      'the platform starts with docker compose up -d',
      started.ok,
      started.ok ? '' : started.out.slice(-400),
    );
    await answers(a, 'the platform answers');
    const loaded = run(
      process.execPath,
      ['--import', 'tsx', 'qa/cli.ts', 'load', '--database', a.databaseUrl],
      {
        cwd: project,
      },
    );
    check('the dataset is loaded', loaded.ok, loaded.ok ? '' : loaded.out.slice(-300));
    const folderA = join(dirA, 'backups', 'auto');
    check(
      'the folder of the backups exists on the host, made by compose, and nothing is in it at noon',
      readdirSync(folderA).filter((name) => name.startsWith('bde-auto-')).length === 0,
      readdirSync(folderA).join(', '),
    );

    // the clock of the platform goes to 03:10: the platform is recreated, and nobody does anything else
    prepare(a, NIGHT, project);
    check('the platform is recreated at 03:10', a.up({ build: false }).ok);
    await answers(a, 'the platform answers again');

    const deadline = Date.now() + 5 * 60_000;
    let archive: string | undefined;
    while (Date.now() < deadline && !archive) {
      archive = readdirSync(folderA).find((name) => /^bde-auto-.*\.tar\.gz$/.test(name));
      if (!archive) await sleep(5_000);
    }
    check(
      'the backup is made by itself, within minutes of 03:00',
      archive !== undefined,
      archive ?? a.logs(30).slice(-600),
    );
    if (!archive) return;

    const secret = inApp(a, 'cat', '/secrets/auth_secret').out.trim();
    const keyA = inApp(a, 'cat', '/secrets/settings_key').out.trim();
    report.watch('auth secret', secret);
    report.watch('settings key', keyA);

    check(
      'the name tells the moment (UTC) it was made',
      /^bde-auto-2026-10-27_0[12]-\d\d-\d\dZ\.tar\.gz$/.test(archive),
      archive,
    );
    const mode = inApp(a, 'stat', '-c', '%a %u', `/auto-backups/${archive}`).out.trim();
    check('the archive is for its owner alone (0600, the application)', mode === '600 1001', mode);

    const listing = inApp(a, 'tar', '-tzf', `/auto-backups/${archive}`)
      .out.split(/\r?\n/)
      .filter(Boolean)
      .sort();
    check(
      'it holds the database, the keys, a note and a manifest',
      listing.join() === ['database.sql', 'info.txt', 'manifest.json', 'secrets.tar'].join(),
      listing.join(', '),
    );

    const status = JSON.parse(inApp(a, 'cat', '/auto-backups/.status.json').out) as {
      attempts: { ok: boolean; kind: string; level?: string; bytes?: number }[];
    };
    const last = status.attempts.at(-1);
    check(
      'the status says: made at night, read again in a database of its own',
      last?.ok === true &&
        last.kind === 'scheduled' &&
        last.level === 'restored' &&
        (last.bytes ?? 0) > 1000,
      JSON.stringify(last),
    );
    const left = readdirSync(folderA).filter(
      (name) => name.startsWith('.') && name !== '.status.json',
    );
    check('nothing half made or locked is left in the folder', left.length === 0, left.join(', '));

    const before = await facts(a);
    check('the control database was dropped', before.scratch === 0, `${before.scratch} left`);
    check(
      'the data satisfies the invariants',
      before.violations.length === 0,
      describeViolations(before.violations),
    );
    check(
      'the platform holds data worth saving',
      (before.counts.Event ?? 0) > 100 && (before.counts.User ?? 0) > 100,
      JSON.stringify(before.counts),
    );
    const owner = await pageAs(a, '/fr/settings', secret);
    check(
      'the owner reads the settings with the session of before (the baseline)',
      shown(owner),
      `${owner.status}`,
    );

    const logs = a.logs(400);
    check(
      'the logs say the backup was made and hold no password or key',
      /Sauvegarde bde-auto-.* faite/.test(logs) &&
        !logs.includes(PASSWORD) &&
        !logs.includes(keyA) &&
        !logs.includes(secret),
      '',
    );

    // ---- 2. every volume of the platform gone -------------------------------------------------------------------------------------
    a.down();
    check(
      'docker compose down -v: the backup is still on the host',
      readdirSync(folderA).includes(archive),
      readdirSync(folderA).join(', '),
    );

    // ---- 3. a server with nothing -----------------------------------------------------------------------------------------------
    prepare(b, NOON, project);
    check('a new server starts', b.up({ build: false }).ok);
    await answers(b, 'and answers (an empty BDE)');
    const emptyKey = inApp(b, 'cat', '/secrets/settings_key').out.trim();
    check('its keys are its own, not the old ones', emptyKey !== '' && emptyKey !== keyA, '');
    const folderB = join(dirB, 'backups', 'auto');
    // the file is carried from one server to the other as an operator would (here by a container, root, whatever its owner)
    const carried = run('docker', [
      'run',
      '--rm',
      '-v',
      `${folderA}:/from:ro`,
      '-v',
      `${folderB}:/to`,
      'alpine',
      'sh',
      '-c',
      'cp /from/bde-auto-*.tar.gz /to/ && chown 1001:1001 /to/*',
    ]);
    check('the archive is put on the new server', carried.ok, carried.out.slice(-300));

    const restored = b.script('restore.sh', '--auto', '--yes');
    check(
      'scripts/restore.sh --auto restores it',
      restored.ok,
      restored.ok ? '' : restored.out.slice(-600),
    );
    await answers(b, 'the platform answers after the restore');

    const after = await facts(b);
    check(
      'the same rows, table by table',
      JSON.stringify(after.counts) === JSON.stringify(before.counts),
      `${JSON.stringify(before.counts)} → ${JSON.stringify(after.counts)}`,
    );
    check(
      'the invariants hold',
      after.violations.length === 0,
      describeViolations(after.violations),
    );
    const keyB = inApp(b, 'cat', '/secrets/settings_key').out.trim();
    const secretB = inApp(b, 'cat', '/secrets/auth_secret').out.trim();
    check(
      'the keys of the old server are back (settings key, session secret)',
      keyB === keyA && secretB === secret,
      '',
    );
    const again = await pageAs(b, '/fr/settings', secret);
    check(
      'the owner is still signed in with the cookie of before',
      shown(again),
      `${again.status}`,
    );
    const sealedLogs = b.logs(300);
    check(
      'the sealed settings were read (no "secrets lost" in the logs)',
      !/lost|illisible/i.test(
        sealedLogs
          .split('\n')
          .filter((l) => /secret/i.test(l))
          .join('\n'),
      ),
      '',
    );
  } finally {
    a.down();
    b.down();
    for (const dir of [dirA, dirB]) {
      // the folders of the backups belong to the application's user: removed by a container
      spawnSync(
        'docker',
        ['run', '--rm', '-v', `${dir}:/x`, 'alpine', 'sh', '-c', 'rm -rf /x/* /x/.[!.]*'],
        { env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
      );
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

async function main() {
  const report = new Report();
  const started = Date.now();
  await playBackups(report);
  console.log(`${report.checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const c of report.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
  const path = flag('report');
  if (path) writeFileSync(path, JSON.stringify(report.checks, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Backups',
        '',
        '| | check | seen |',
        '|---|---|---|',
        ...report.checks.map(
          (c) =>
            `| ${c.ok ? '✅' : '❌'} | ${tableCell(c.name)} | ${tableCell(c.detail.replace(/\n/g, ' ').slice(0, 400))} |`,
        ),
        '',
      ].join('\n'),
    );
  }
  if (report.failures.length > 0) {
    console.error(report.describeFailures());
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
