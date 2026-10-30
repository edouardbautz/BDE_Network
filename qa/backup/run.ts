import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
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
 *   tsx qa/backup/run.ts [--report report.json] [--refuse-chown]
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
/**
 * 01:00 in Paris: before the hour of the backup, so that a platform started with this clock makes none by itself (a clock at midday would be
 * past 03:00 with no backup of the day: the first look of the loop, a minute after the start, would make one, and `restore.sh --auto`, which takes the
 * newest, would restore the empty platform's).
 */
/** Ten minutes later: the name of a backup is its second, and the server that restores the first one must not make one of the same name. */
const LATER = '2026-10-27T02:20:00Z';
const EARLY = '2026-10-27T00:00:00Z';

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
  // a clone of the project ships backups/ (.gitkeep): the user's, where scripts/backup.sh writes; Docker makes only backups/auto inside it
  mkdirSync(join(dir, 'backups'));
  for (const name of ['backup.sh', 'restore.sh']) {
    copyFileSync(join(project, 'scripts', name), join(dir, 'scripts', name));
  }
  return dir;
}

/**
 * `--refuse-chown`: the file system of the folder refuses the change of owner, as a network disk does under a rootless Docker (the school's
 * computers). The folder is the host user's and private to them, and the `secrets` service (root of the container, so the host user's
 * own rights) is an image whose `chown` answers "not permitted": the platform must open the folder by other means, not leave
 * the application unable to list it.
 */
const REFUSE_CHOWN = process.argv.includes('--refuse-chown');
/** The alert of the Settings page about the folder, as it is drawn (the same words are also in the catalog the page carries, between quotes). */
const FOLDER_ALERT = '>Le dossier des sauvegardes n’est pas utilisable<';
const REFUSING_IMAGE = 'bde-secrets-nochown:local';

function refusingImage(): boolean {
  // `chown` of the image, except that it answers "not permitted" for the folder of the backups, and only for it (the volume of the keys is the platform's own).
  const stand = [
    '#!/bin/sh',
    'for argument in "$@"; do',
    '  if [ "$argument" = /auto-backups ]; then echo "chown: $argument: Operation not permitted" >&2; exit 1; fi',
    'done',
    'exec /bin/busybox chown "$@"',
    '',
  ].join('\n');
  const dockerfile = [
    'FROM postgres:17-alpine',
    `RUN rm /bin/chown && echo ${Buffer.from(stand).toString('base64')} | base64 -d > /bin/chown && chmod +x /bin/chown`,
    '',
  ].join('\n');
  const built = spawnSync('docker', ['build', '-q', '-t', REFUSING_IMAGE, '-'], {
    input: dockerfile,
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return built.status === 0;
}

function prepare(stack: Stack, now: string, project: string): void {
  environmentOf(stack);
  stack.prepare({
    mountsConfig: true,
    build: true,
    ...(REFUSE_CHOWN ? { secretsImage: REFUSING_IMAGE } : {}),
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
    if (REFUSE_CHOWN) {
      check('the image whose chown is refused is built', refusingImage());
      for (const dir of [dirA, dirB]) {
        // the folder of a user who made it themselves: theirs, and private
        mkdirSync(join(dir, 'backups', 'auto'), { recursive: true });
        chmodSync(join(dir, 'backups', 'auto'), 0o700);
      }
    }
    // ---- 1. a platform with data, left alone at the hour of the backup ---------------------------------------------------------
    prepare(a, EARLY, project);
    const started = a.up({ build: false });
    check(
      'the platform starts with docker compose up -d',
      started.ok,
      started.ok ? '' : started.out.slice(-400),
    );
    await answers(a, 'the platform answers');
    const loaded = run(
      'node',
      ['--import', 'tsx', 'qa/cli.ts', 'load', '--database', a.databaseUrl],
      {
        cwd: project,
      },
    );
    check('the dataset is loaded', loaded.ok, loaded.ok ? '' : loaded.out.slice(-300));
    const folderA = join(dirA, 'backups', 'auto');
    if (REFUSE_CHOWN) {
      const mode = (statSync(folderA).mode & 0o7777).toString(8);
      check(
        'the file system refused the change of owner: the folder was opened for the application instead (1777)',
        mode === '1777' &&
          a.compose('logs', '--no-color', 'secrets').out.includes('open to every user'),
        mode,
      );
    }
    check(
      'the folder of the backups exists on the host, made by compose, and nothing is in it before 03:00',
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
    check(
      'the Settings page lists the backup and has nothing to say about the folder',
      owner.body.includes('Sauvegardes gardées') &&
        owner.body.includes('27 octobre 2026') &&
        !owner.body.includes(FOLDER_ALERT),
      `${owner.body.includes('Sauvegardes gardées')} ${owner.body.includes('27 octobre 2026')} ${owner.body.includes(FOLDER_ALERT)}`,
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

    // ---- the download: an owner takes the file away, encrypted with a passphrase of their own -------------------------------------
    const PASSPHRASE = 'correct horse battery staple';
    const download = (passphrase: string, origin?: string) =>
      fetch(`${a.base}/api/backups/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE}=${cookieValue}`,
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify({ name: archive, passphrase }),
        signal: AbortSignal.timeout(60_000),
      });
    const cookieValue = await forgeSessionCookie(OWNER, secret);
    const tooShort = await download('short');
    check('a passphrase of 5 characters is refused', tooShort.status === 400, `${tooShort.status}`);
    const stranger = await download(PASSPHRASE, 'https://evil.example');
    check(
      'a download asked from another site is refused',
      stranger.status === 403,
      `${stranger.status}`,
    );
    const visitor = await fetch(`${a.base}/api/backups/download`, {
      method: 'POST',
      body: JSON.stringify({ name: archive, passphrase: PASSPHRASE }),
    });
    check(
      'a visitor gets a bare 404',
      visitor.status === 404 && (await visitor.text()) === '',
      `${visitor.status}`,
    );
    const file = await download(PASSPHRASE);
    check('the owner downloads the backup', file.status === 200, `${file.status}`);
    const encrypted = Buffer.from(await file.arrayBuffer());
    const encName = `${archive}.enc`;
    const encFile = join(dirB, encName);
    writeFileSync(encFile, encrypted);
    check(
      'what is downloaded is an openssl file, and holds nothing readable',
      encrypted.subarray(0, 8).toString('ascii') === 'Salted__' &&
        !encrypted.includes('PostgreSQL database dump') &&
        !encrypted.includes(keyA),
      `${encrypted.length} bytes`,
    );
    check(
      'it is named after the backup, plus .enc',
      /bde-auto-.*.tar.gz.enc/.test(file.headers.get('content-disposition') ?? ''),
      file.headers.get('content-disposition') ?? '',
    );
    const audited = await a.database(
      async (db) =>
        (
          await db.query(
            `SELECT metadata::text AS m, "actorLogin" FROM "AuditLog" WHERE action = 'backup.download'`,
          )
        ).rows,
    );
    check(
      'the download is in the audit log, once, with who and which backup, never the passphrase',
      audited.length === 1 &&
        audited[0]?.actorLogin === OWNER &&
        !String(audited[0]?.m).includes(PASSPHRASE),
      JSON.stringify(audited),
    );

    // ---- 2. every volume of the platform gone -------------------------------------------------------------------------------------
    a.down();
    check(
      'docker compose down -v: the backup is still on the host',
      readdirSync(folderA).includes(archive),
      readdirSync(folderA).join(', '),
    );

    // ---- 3. a server with nothing -----------------------------------------------------------------------------------------------
    prepare(b, EARLY, project);
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
      restored.ok ? '' : restored.out.slice(-1500),
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
    // ---- 4. the same, from the file that was downloaded -----------------------------------------------------------------------------
    await b.database((db) => db.query('DELETE FROM "AuditLog"'));
    const refused = b.scriptWith(
      { BDE_BACKUP_PASSPHRASE: 'not the passphrase' },
      'restore.sh',
      encName,
      '--yes',
    );
    const untouched = await b.database(async (db) =>
      Number((await db.query('SELECT count(*) AS n FROM "AuditLog"')).rows[0]?.n),
    );
    check(
      'restore.sh refuses a wrong passphrase and touches nothing',
      !refused.ok && untouched === 0,
      refused.out.slice(-200),
    );
    const fromFile = b.scriptWith(
      { BDE_BACKUP_PASSPHRASE: PASSPHRASE },
      'restore.sh',
      encName,
      '--yes',
    );
    check(
      'restore.sh restores the downloaded file with its passphrase',
      fromFile.ok,
      fromFile.ok ? '' : fromFile.out.slice(-1500),
    );
    await answers(b, 'the platform answers after the second restore');
    const fromDownload = await facts(b);
    check(
      'the same rows again, table by table',
      JSON.stringify(fromDownload.counts) === JSON.stringify(before.counts),
      `${JSON.stringify(fromDownload.counts)}`,
    );
    const stillIn = await pageAs(b, '/fr/settings', secret);
    check('and the owner is still signed in', shown(stillIn), `${stillIn.status}`);

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

    // ---- 5. the database is down at the hour of the backup ----------------------------------------------------------------------------
    // The platform is recreated at 03:10 and its database stopped before the first look of the loop (a minute after the start): the
    // backup cannot be made. What was there stays, nothing half made is left, the failure is written down, and the page says so.
    prepare(b, LATER, project);
    check('the platform is recreated at 03:10 once more', b.up({ build: false }).ok);
    await answers(b, 'and answers (at 03:10)');
    const stopped = b.compose('stop', 'postgres');
    check('the database is stopped', stopped.ok, stopped.out.slice(-200));
    const failedAt = Date.now() + 5 * 60_000;
    let attempt: { ok: boolean; code?: string; kind?: string } | undefined;
    while (Date.now() < failedAt && !attempt) {
      try {
        const written = JSON.parse(inApp(b, 'cat', '/auto-backups/.status.json').out) as {
          attempts: { ok: boolean; code?: string; kind?: string }[];
        };
        attempt = written.attempts.at(-1);
      } catch {
        // not written yet
      }
      if (!attempt) await sleep(5_000);
    }
    check(
      'a backup that cannot be made is written down, with its reason',
      attempt?.ok === false && attempt.code === 'dump' && attempt.kind === 'scheduled',
      JSON.stringify(attempt),
    );
    const kept = inApp(b, 'ls', '-A', '/auto-backups').out.split(/\r?\n/).filter(Boolean).sort();
    check(
      'the backup that was there is untouched and nothing half made is left',
      kept.join() === ['.status.json', archive].sort().join(),
      kept.join(', '),
    );
    const down = await fetch(`${b.base}/api/health`, { signal: AbortSignal.timeout(10_000) }).then(
      (response) => response.status,
      () => 0,
    );
    check('the platform says its database is down (503)', down === 503, `${down}`);

    check('the database is started again', b.compose('start', 'postgres').ok);
    await answers(b, 'and the platform answers again');
    const warned = await pageAs(b, '/fr/settings', secret);
    check(
      'the Settings page says that the last attempt failed, and why',
      /La dernière tentative a échoué/.test(warned.body) &&
        /n.a pas pu être exportée/.test(warned.body),
      `${warned.status}`,
    );
    check(
      'and that nobody is told by message, since no channel is chosen',
      /Aucun message ne prévient les propriétaires/.test(warned.body),
      '',
    );

    // ---- 6. the folder cannot be used: the page says which folder, what is wrong with it and what to do ----------------------------
    const asRoot = (...command: string[]) =>
      b.compose('exec', '-T', '-u', 'root', 'app', ...command);
    const spoiled = asRoot('sh', '-c', 'chown 0:0 /auto-backups && chmod 700 /auto-backups');
    check(
      'the folder is made private to another user, as a file system that refuses the change of owner leaves it',
      spoiled.ok,
      spoiled.out.slice(-200),
    );
    const refusedPage = await pageAs(b, '/fr/settings', secret);
    check(
      'the Settings page names the folder checked, on the platform and on the server',
      refusedPage.body.includes('Le dossier des sauvegardes n’est pas utilisable') &&
        refusedPage.body.includes(
          'Dossier vérifié : /auto-backups (sur le serveur : ./backups/auto)',
        ),
      `${refusedPage.status}`,
    );
    check(
      'it says who owns the folder and with which rights, and what to do on the server',
      refusedPage.body.includes('il appartient à 0:0 avec les droits 700') &&
        refusedPage.body.includes('chmod 1777 ./backups/auto'),
      '',
    );
    check('the platform is restarted', b.compose('restart', 'app').ok);
    await answers(b, 'and answers with the folder unusable');
    check(
      'the logs say it at the start, with the path, the user and the rights',
      /le dossier des sauvegardes n'est pas utilisable.*utilisateur de la plateforme 1001.*droits 700/.test(
        b.logs(100),
      ),
      b.logs(20).slice(-400),
    );
    const healed = asRoot('sh', '-c', 'chown 1001:1001 /auto-backups && chmod 755 /auto-backups');
    check('the folder is handed back', healed.ok, healed.out.slice(-200));
    const fine = await pageAs(b, '/fr/settings', secret);
    check(
      'and the Settings page has nothing to say about the folder any more',
      !fine.body.includes(FOLDER_ALERT),
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
