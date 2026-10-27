// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seal } from '@/lib/settings/crypto';
import { realExec, type Exec } from './exec';
import { archiveName } from './names';
import { runBackup, type BackupContext } from './run';
import { readStatus } from './status';
import { verifyArchive } from './verify';
import { connectionOf } from './connection';

/**
 * The whole of a backup, with a real `tar` and real files, and a PostgreSQL played by a few lines: `pg_dump` writes a dump, `psql`
 * answers like a database that loaded it. (The real PostgreSQL is played by qa/backup against the real image.)
 */
const DATABASE_URL = 'postgresql://bde:secret-password@postgres:5432/bde_network?schema=public';
const FOOTER = '--\n-- PostgreSQL database dump complete\n--\n';

let root: string;
let dir: string;
let secretsDir: string;
let uploadsDir: string;
const key = randomBytes(32);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bde-backup-test-'));
  dir = join(root, 'backups');
  secretsDir = join(root, 'secrets');
  uploadsDir = join(root, 'uploads');
  mkdirSync(secretsDir);
  mkdirSync(uploadsDir);
  writeFileSync(join(secretsDir, 'auth_secret'), 'the-session-secret-0123456789abcdef0123456789\n');
  writeFileSync(join(secretsDir, 'settings_key'), `${key.toString('base64')}\n`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

interface Play {
  dumpCode?: number;
  dump?: string;
  canCreate?: boolean;
  loadCode?: number;
  /** What the copy's PlatformSettings.secrets holds. */
  sealed?: string;
  migrations?: string;
}

function database(play: Play = {}) {
  const calls: { command: string; args: string[]; env?: Record<string, string> }[] = [];
  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args: [...args], env: options?.env });
    if (command === 'tar') return realExec(command, args, options);
    if (command === 'pg_dump') {
      writeFileSync(options!.stdoutFile!, play.dump ?? `CREATE TABLE "User" ();\n${FOOTER}`);
      return {
        code: play.dumpCode ?? 0,
        stdout: '',
        stderr: play.dumpCode ? 'pg_dump: connection refused' : '',
      };
    }
    const sql = args[args.indexOf('-c') + 1] ?? '';
    if (args.includes('-f')) return { code: play.loadCode ?? 0, stdout: '', stderr: '' };
    if (sql.startsWith('CREATE DATABASE')) {
      return play.canCreate === false
        ? { code: 1, stdout: '', stderr: 'ERROR:  permission denied to create database' }
        : { code: 0, stdout: '', stderr: '' };
    }
    if (sql.startsWith('DROP DATABASE')) return { code: 0, stdout: '', stderr: '' };
    if (sql.includes('_prisma_migrations'))
      return { code: 0, stdout: `${play.migrations ?? '13'}\n`, stderr: '' };
    if (sql.includes('information_schema')) return { code: 0, stdout: '14\n', stderr: '' };
    if (sql.includes('PlatformSettings'))
      return {
        code: 0,
        stdout: `${play.sealed ?? seal({ FORTYTWO_CLIENT_SECRET: 'x' }, key)}\n`,
        stderr: '',
      };
    return { code: 1, stdout: '', stderr: 'unexpected query' };
  };
  return { exec, calls };
}

function context(
  exec: Exec,
  at = '2026-10-27T02:00:04Z',
  over: Partial<BackupContext> = {},
): BackupContext {
  const lines: string[] = [];
  return {
    dir,
    secretsDir,
    uploadsDir,
    databaseUrl: DATABASE_URL,
    timeZone: 'Europe/Paris',
    version: '1.5.0',
    env: {},
    exec,
    now: () => new Date(at),
    log: (line) => lines.push(line),
    ...over,
  };
}

const archives = () => readdirSync(dir).filter((name) => name.startsWith('bde-auto-'));

describe('a backup that works', () => {
  it('makes one archive, named by its moment, readable by its owner only, with everything needed to start again', async () => {
    const result = await runBackup(context(database().exec), 'scheduled');

    expect(result).toMatchObject({
      ok: true,
      name: 'bde-auto-2026-10-27_02-00-04Z.tar.gz',
      level: 'restored',
    });
    expect(archives()).toEqual(['bde-auto-2026-10-27_02-00-04Z.tar.gz']);
    if (process.platform !== 'win32')
      expect(statSync(join(dir, archives()[0]!)).mode & 0o077).toBe(0);

    const listing = await realExec('tar', ['-tzf', archives()[0]!], { cwd: dir });
    expect(listing.stdout.split(/\r?\n/).filter(Boolean).sort()).toEqual([
      'database.sql',
      'info.txt',
      'manifest.json',
      'secrets.tar',
    ]);
  });

  it('puts the logo in it when there is one', async () => {
    writeFileSync(join(uploadsDir, 'logo-0123456789abcdef'), 'PNG');
    writeFileSync(join(uploadsDir, 'something-else'), 'not a logo');
    await runBackup(context(database().exec), 'scheduled');

    const listing = await realExec('tar', ['-tzf', archives()[0]!], { cwd: dir });
    expect(listing.stdout).toContain('logo.tar');
  });

  it('reaches the database with variables of its own, never a password on a command line', async () => {
    const play = database();
    await runBackup(context(play.exec), 'scheduled');

    const dump = play.calls.find((call) => call.command === 'pg_dump')!;
    expect(dump.args).toEqual(['--clean', '--if-exists']);
    expect(dump.env).toMatchObject({
      PGHOST: 'postgres',
      PGUSER: 'bde',
      PGPASSWORD: 'secret-password',
      PGDATABASE: 'bde_network',
    });
    expect(JSON.stringify(play.calls.map((call) => call.args))).not.toContain('secret-password');
  });

  it('reads the archive again in a scratch database and drops it, keys of the archive and not of the platform', async () => {
    const play = database();
    await runBackup(
      context(play.exec, undefined, { env: { SETTINGS_KEY: randomBytes(32).toString('base64') } }),
      'scheduled',
    );

    const sql = play.calls
      .filter((call) => call.command === 'psql')
      .map((call) => call.args[call.args.indexOf('-c') + 1] ?? '');
    expect(sql.some((line) => line.startsWith('CREATE DATABASE bde_verify_'))).toBe(true);
    expect(
      sql.some(
        (line) => line.includes('DROP DATABASE IF EXISTS bde_verify_') && line.includes('FORCE'),
      ),
    ).toBe(true);
    expect(readdirSync(dir).filter((name) => name.startsWith('.'))).toEqual(
      expect.arrayContaining(['.status.json']),
    );
    expect(readdirSync(dir).filter((name) => /^\.(work|partial|verify)/.test(name))).toEqual([]);
  });

  it('says it was only read when the server does not let it make a database', async () => {
    const result = await runBackup(context(database({ canCreate: false }).exec), 'scheduled');
    expect(result).toMatchObject({ ok: true, level: 'read' });
  });

  it('takes the keys from the environment when there is no secrets volume (a plain docker run)', async () => {
    rmSync(secretsDir, { recursive: true });
    const result = await runBackup(
      context(database().exec, undefined, {
        env: {
          AUTH_SECRET: 'an-auth-secret-of-more-than-thirty-two-characters',
          SETTINGS_KEY: key.toString('base64'),
        },
      }),
      'scheduled',
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('records the attempt in the status next to the backups', async () => {
    await runBackup(context(database().exec), 'manual');
    const status = await readStatus(dir, new Date());
    expect(status.attempts).toHaveLength(1);
    expect(status.attempts[0]).toMatchObject({
      ok: true,
      kind: 'manual',
      level: 'restored',
      name: 'bde-auto-2026-10-27_02-00-04Z.tar.gz',
    });
    expect(status.attempts[0]?.bytes).toBeGreaterThan(0);
  });
});

describe('a backup that does not work leaves what was there as it was', () => {
  const previous = archiveName(new Date('2026-10-26T02:00:00Z'));
  beforeEach(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, previous), 'the backup of yesterday');
  });

  it.each([
    ['the dump fails', { dumpCode: 1 }, 'dump'],
    ['the dump is cut', { dump: 'CREATE TABLE "User" ();\n' }, 'dump'],
    ['the dump does not load', { loadCode: 3 }, 'verify-restore'],
    ['the copy has no migration', { migrations: '0' }, 'verify-restore'],
    [
      'the keys of the archive do not open the sealed settings',
      { sealed: seal({ A: 'b' }, randomBytes(32)) },
      'verify-secrets',
    ],
  ] as const)(
    '%s: a failure with a code, nothing new, nothing left over',
    async (_what, play, code) => {
      const result = await runBackup(context(database(play).exec), 'scheduled');

      expect(result).toEqual({ ok: false, code });
      expect(archives()).toEqual([previous]);
      expect(readFileSync(join(dir, previous), 'utf8')).toBe('the backup of yesterday');
      expect(readdirSync(dir).filter((name) => /^\.(work|partial|verify)/.test(name))).toEqual([]);
      expect((await readStatus(dir, new Date())).attempts.at(-1)).toMatchObject({
        ok: false,
        code,
      });
    },
  );

  it('does not put the password or the output of a tool in the status', async () => {
    await runBackup(context(database({ dumpCode: 1 }).exec), 'scheduled');
    const text = readFileSync(join(dir, '.status.json'), 'utf8');
    expect(text).not.toContain('secret-password');
    expect(text).not.toContain('connection refused');
  });

  it('answers busy, and writes nothing, when another backup is running', async () => {
    writeFileSync(join(dir, '.lock'), '{}');
    const result = await runBackup(context(database().exec), 'manual');
    expect(result).toEqual({ ok: false, code: 'busy' });
    expect(existsSync(join(dir, '.status.json'))).toBe(false);
    expect(archives()).toEqual([previous]);
  });

  it('takes over a lock that a crash left two hours ago', async () => {
    writeFileSync(join(dir, '.lock'), '{}');
    const old = new Date('2026-10-27T02:00:04Z').getTime() - 3 * 3_600_000;
    const { utimesSync } = await import('node:fs');
    utimesSync(join(dir, '.lock'), old / 1000, old / 1000);
    expect(await runBackup(context(database().exec), 'scheduled')).toMatchObject({ ok: true });
    expect(existsSync(join(dir, '.lock'))).toBe(false);
  });

  it('frees the lock whatever happened', async () => {
    await runBackup(context(database({ dumpCode: 1 }).exec), 'scheduled');
    expect(existsSync(join(dir, '.lock'))).toBe(false);
  });
});

describe('the rotation, after a backup', () => {
  it('lets go of what the policy lets go of, and of nothing that is not an automatic backup', async () => {
    mkdirSync(dir, { recursive: true });
    for (let day = 1; day <= 12; day += 1) {
      writeFileSync(join(dir, archiveName(new Date(Date.UTC(2026, 9, day, 2)))), 'x');
    }
    writeFileSync(join(dir, 'bde-backup-2026-01-01_00-00-00.tar.gz'), 'made by scripts/backup.sh');
    writeFileSync(join(dir, 'notes.txt'), 'mine');

    const result = await runBackup(context(database().exec, '2026-10-27T02:00:04Z'), 'scheduled');

    expect(result.ok).toBe(true);
    expect(archives()).not.toContain(archiveName(new Date(Date.UTC(2026, 9, 2, 2))));
    expect(existsSync(join(dir, 'bde-backup-2026-01-01_00-00-00.tar.gz'))).toBe(true);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
    expect(archives()).toContain('bde-auto-2026-10-27_02-00-04Z.tar.gz');
    expect(archives().length).toBeLessThanOrEqual(7 + 4 + 6);
  });
});

describe('opening a backup again', () => {
  it('refuses an archive whose files are not what the manifest says', async () => {
    const play = database();
    await runBackup(context(play.exec), 'scheduled');
    const name = archives()[0]!;

    // change one byte of the dump inside the archive, and make the archive again
    const opened = join(dir, 'tamper');
    mkdirSync(opened);
    await realExec('tar', ['-xzf', name, '-C', 'tamper'], { cwd: dir });
    writeFileSync(
      join(opened, 'database.sql'),
      readFileSync(join(opened, 'database.sql'), 'utf8').replace('User', 'Usex'),
    );
    await realExec(
      'tar',
      [
        '-czf',
        'tampered.tar.gz',
        '-C',
        'tamper',
        'database.sql',
        'secrets.tar',
        'info.txt',
        'manifest.json',
      ],
      { cwd: dir },
    );

    await expect(
      verifyArchive({
        archive: 'tampered.tar.gz',
        cwd: dir,
        scratchDir: '.verify-x',
        exec: play.exec,
        connection: connectionOf(DATABASE_URL),
      }),
    ).rejects.toMatchObject({ code: 'verify-archive' });
  });

  it('refuses a file that is not an archive', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.tar.gz'), 'not a tar');
    await expect(
      verifyArchive({
        archive: 'broken.tar.gz',
        cwd: dir,
        scratchDir: '.verify-y',
        exec: database().exec,
        connection: connectionOf(DATABASE_URL),
      }),
    ).rejects.toMatchObject({ code: 'verify-archive' });
  });
});

describe('room on the disk', () => {
  it('stops with its own reason, before dumping anything, when there is less than 50 MiB', async () => {
    const play = database();
    const result = await runBackup(
      { ...context(play.exec), freeBytes: async () => 10 * 1024 * 1024 },
      'scheduled',
    );
    expect(result).toEqual({ ok: false, code: 'space' });
    expect(play.calls).toEqual([]);
  });

  it('wants three times the last backup', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '.status.json'),
      JSON.stringify({
        version: 1,
        since: '2026-01-01T00:00:00Z',
        alerts: {},
        attempts: [
          { at: '2026-10-26T02:00:00Z', ok: true, kind: 'scheduled', bytes: 30 * 1024 * 1024 },
        ],
      }),
    );
    const tight = await runBackup(
      { ...context(database().exec), freeBytes: async () => 80 * 1024 * 1024 },
      'scheduled',
    );
    expect(tight).toEqual({ ok: false, code: 'space' });
    const roomy = await runBackup(
      {
        ...context(database().exec, '2026-10-27T02:40:00Z'),
        freeBytes: async () => 100 * 1024 * 1024,
      },
      'scheduled',
    );
    expect(roomy).toMatchObject({ ok: true });
  });
});

describe('a dump that is cut but whose manifest agrees with it', () => {
  it('is refused by the check on its own, whatever made the archive', async () => {
    mkdirSync(dir, { recursive: true });
    const work = join(dir, 'cut');
    mkdirSync(work);
    const sql = 'CREATE TABLE "User" ();\n';
    writeFileSync(join(work, 'database.sql'), sql);
    writeFileSync(join(work, 'secrets.tar'), 'keys');
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    writeFileSync(
      join(work, 'manifest.json'),
      JSON.stringify({
        format: 1,
        createdAt: '2026-10-27T02:00:00Z',
        version: '1.5.0',
        timeZone: 'Europe/Paris',
        secrets: true,
        logo: false,
        files: {
          'database.sql': { bytes: sql.length, sha256: sha(sql) },
          'secrets.tar': { bytes: 4, sha256: sha('keys') },
        },
      }),
    );
    await realExec(
      'tar',
      ['-czf', 'cut.tar.gz', '-C', 'cut', 'database.sql', 'secrets.tar', 'manifest.json'],
      { cwd: dir },
    );
    await expect(
      verifyArchive({
        archive: 'cut.tar.gz',
        cwd: dir,
        scratchDir: '.verify-z',
        exec: database().exec,
        connection: connectionOf(DATABASE_URL),
      }),
    ).rejects.toMatchObject({
      code: 'verify-archive',
      message: expect.stringContaining('not complete'),
    });
  });
});
