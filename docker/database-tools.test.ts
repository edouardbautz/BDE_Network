// @vitest-environment node
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseTools } from './database-tools.mjs';

const URL = 'postgresql://bde:p%40ss@postgres:5432/bde_network?schema=public';
const COMPLETE = '-- dump\nCREATE TABLE "User" ();\n--\n-- PostgreSQL database dump complete\n--\n';

interface Call {
  command: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
}

/** A command that never runs: answers what it is told to, and keeps what it was given. */
function fakeSpawn(
  respond: (call: Omit<Call, 'stdin'>) => { stdout?: string; stderr?: string; code?: number },
) {
  const calls: Call[] = [];
  const spawn = (command: string, args: string[], options: { env: Record<string, string> }) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const call: Call = { command, args, env: options.env, stdin: '' };
    calls.push(call);
    child.stdin.on('data', (chunk) => (call.stdin += chunk.toString()));
    const answer = respond({ command, args, env: options.env });
    // The answer comes once the input (if any) has been read to its end, like a real command.
    const finish = () => {
      if (answer.stdout) child.stdout.write(answer.stdout);
      if (answer.stderr) child.stderr.write(answer.stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', answer.code ?? 0));
    };
    if (command === 'psql' && args.includes('--single-transaction')) child.stdin.on('end', finish);
    else setImmediate(finish);
    return child;
  };
  return { spawn, calls };
}

describe('createDatabaseTools', () => {
  let dir: string;
  let backupsDir: string;
  let migrationsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bde-tools-'));
    backupsDir = join(dir, 'backups');
    migrationsDir = join(dir, 'migrations');
    mkdirSync(migrationsDir);
    for (const name of ['20260804215820_init', '20261005120000_add_events']) {
      mkdirSync(join(migrationsDir, name));
    }
    writeFileSync(join(migrationsDir, 'migration_lock.toml'), 'provider = "postgresql"');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const tools = (spawn: unknown, over: Record<string, unknown> = {}) =>
    createDatabaseTools({
      env: { DATABASE_URL: URL },
      spawn: spawn as never,
      migrationsDir,
      backupsDir,
      version: '1.1.0',
      now: () => new Date('2026-10-15T10:15:30Z'),
      ...over,
    });

  it('has no address when the stack cannot build one', () => {
    expect(tools(fakeSpawn(() => ({})).spawn, { env: { DATABASE_URL: '' } }).hasAddress()).toBe(
      false,
    );
    expect(tools(fakeSpawn(() => ({})).spawn).hasAddress()).toBe(true);
  });

  describe('inspect', () => {
    it('reaches the database through variables, never through the command line', async () => {
      const { spawn, calls } = fakeSpawn(() => ({ stdout: 'f\n' }));
      await tools(spawn).inspect();

      expect(calls[0]?.command).toBe('psql');
      expect(calls[0]?.env).toMatchObject({
        PGHOST: 'postgres',
        PGUSER: 'bde',
        PGPASSWORD: 'p@ss',
      });
      expect(calls[0]?.args.join(' ')).not.toContain('p@ss');
    });

    it('a database without the migrations table is a new installation', async () => {
      const { spawn } = fakeSpawn(() => ({ stdout: 'f\n' }));
      expect(await tools(spawn).inspect()).toMatchObject({ state: 'fresh' });
    });

    it('compares what is applied with the folders of the image', async () => {
      const { spawn } = fakeSpawn((call) =>
        call.args.join(' ').includes('to_regclass')
          ? { stdout: 't\n' }
          : { stdout: '20260804215820_init|t|f\n' },
      );
      expect(await tools(spawn).inspect()).toMatchObject({
        state: 'pending',
        pending: ['20261005120000_add_events'],
      });
    });

    it('says "unreachable" when the database does not answer, so that the migration classifies it', async () => {
      const { spawn } = fakeSpawn(() => ({ code: 2, stderr: 'connection refused' }));
      expect(await tools(spawn).inspect()).toMatchObject({ state: 'unreachable' });
    });
  });

  describe('backup', () => {
    it('writes a complete, compressed dump named after the instant and the version', async () => {
      const { spawn, calls } = fakeSpawn(() => ({ stdout: COMPLETE }));
      const name = await tools(spawn).backup();

      expect(name).toBe('pre-update_20261015T101530Z_v1.1.0.sql.gz');
      expect(calls[0]?.command).toBe('pg_dump');
      expect(calls[0]?.args).toEqual(['--clean', '--if-exists', '--no-password']);
      expect(gunzipSync(readFileSync(join(backupsDir, name))).toString()).toBe(COMPLETE);
      expect(readdirSync(backupsDir)).toEqual([name]); // no partial file left
    });

    it('refuses a dump that was cut short, and leaves nothing behind', async () => {
      const { spawn } = fakeSpawn(() => ({ stdout: '-- dump\nCREATE TABLE "User" ();\n' }));
      await expect(tools(spawn).backup()).rejects.toThrow('incomplete');
      expect(readdirSync(backupsDir)).toEqual([]);
    });

    it('fails, and leaves nothing behind, when pg_dump fails', async () => {
      const { spawn } = fakeSpawn(() => ({
        code: 1,
        stdout: COMPLETE,
        stderr: 'no space left on device',
      }));
      await expect(tools(spawn).backup()).rejects.toThrow('no space left');
      expect(readdirSync(backupsDir)).toEqual([]);
    });
  });

  describe('restore', () => {
    const placeCopy = (content = COMPLETE) => {
      mkdirSync(backupsDir, { recursive: true });
      const name = 'pre-update_20261015T101530Z_v1.1.0.sql.gz';
      writeFileSync(join(backupsDir, name), gzipSync(content));
      return name;
    };

    it('starts from an empty schema, in one transaction, then loads the copy', async () => {
      const name = placeCopy();
      const { spawn, calls } = fakeSpawn(() => ({}));
      await tools(spawn).restore(name);

      const [call] = calls;
      expect(call?.command).toBe('psql');
      expect(call?.args).toEqual(
        expect.arrayContaining(['--single-transaction', 'ON_ERROR_STOP=1']),
      );
      // The schema is dropped first: a migration that failed halfway may have added tables the copy does not know.
      expect(
        call?.stdin.startsWith('DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n'),
      ).toBe(true);
      expect(call?.stdin.endsWith(COMPLETE)).toBe(true);
    });

    it('fails when psql fails, and when the copy is not there', async () => {
      const name = placeCopy();
      const failing = fakeSpawn(() => ({ code: 3, stderr: 'ERROR: syntax error' }));
      await expect(tools(failing.spawn).restore(name)).rejects.toThrow('syntax error');
      await expect(
        tools(fakeSpawn(() => ({})).spawn).restore('pre-update_20200101T000000Z_v0.0.0.sql.gz'),
      ).rejects.toThrow();
    });
  });

  describe('the copies on disk', () => {
    const touch = (name: string) => {
      mkdirSync(backupsDir, { recursive: true });
      writeFileSync(join(backupsDir, name), 'x');
    };

    it('finds the newest', () => {
      touch('pre-update_20261001T000000Z_v1.0.0.sql.gz');
      touch('pre-update_20261014T000000Z_v1.0.1.sql.gz');
      touch('README');
      expect(tools(fakeSpawn(() => ({})).spawn).latestBackup()).toBe(
        'pre-update_20261014T000000Z_v1.0.1.sql.gz',
      );
    });

    it('prunes what the retention says, and only that', () => {
      for (let day = 1; day <= 7; day++) {
        touch(`pre-update_202610${String(day).padStart(2, '0')}T000000Z_v1.0.0.sql.gz`);
      }
      touch('mine.txt');
      tools(fakeSpawn(() => ({})).spawn).prune();

      expect(readdirSync(backupsDir).sort()).toEqual([
        'mine.txt',
        'pre-update_20261003T000000Z_v1.0.0.sql.gz',
        'pre-update_20261004T000000Z_v1.0.0.sql.gz',
        'pre-update_20261005T000000Z_v1.0.0.sql.gz',
        'pre-update_20261006T000000Z_v1.0.0.sql.gz',
        'pre-update_20261007T000000Z_v1.0.0.sql.gz',
      ]);
    });

    it('keeps its copies in pre-update/ of the folder of the backups, where the nightly ones are', () => {
      const t = createDatabaseTools({
        env: { DATABASE_URL: URL, BDE_BACKUP_DIR: join(dir, 'auto') },
        spawn: fakeSpawn(() => ({})).spawn as never,
        migrationsDir,
        now: () => new Date('2026-10-15T10:15:30Z'),
      });
      mkdirSync(join(dir, 'auto', 'pre-update'), { recursive: true });
      writeFileSync(
        join(dir, 'auto', 'pre-update', 'pre-update_20261014T000000Z_v1.0.1.sql.gz'),
        'x',
      );
      expect(t.latestBackup()).toBe('pre-update_20261014T000000Z_v1.0.1.sql.gz');
    });

    describe('the copies of the old volume (stacks before 4)', () => {
      let legacyDir: string;
      beforeEach(() => {
        legacyDir = join(dir, 'legacy');
        mkdirSync(legacyDir);
      });
      const legacy = (name: string, content = 'old') =>
        writeFileSync(join(legacyDir, name), content);
      const withLegacy = () => tools(fakeSpawn(() => ({})).spawn, { legacyDir });

      it('are carried into the folder, once, and the old volume is left as it was', () => {
        legacy('pre-update_20261001T000000Z_v1.0.0.sql.gz');
        legacy('pre-update_20261014T000000Z_v1.4.0.sql.gz', 'newest');
        legacy('README');
        const t = withLegacy();
        expect(t.importLegacy().sort()).toEqual([
          'pre-update_20261001T000000Z_v1.0.0.sql.gz',
          'pre-update_20261014T000000Z_v1.4.0.sql.gz',
        ]);
        expect(readdirSync(backupsDir).sort()).toEqual([
          'pre-update_20261001T000000Z_v1.0.0.sql.gz',
          'pre-update_20261014T000000Z_v1.4.0.sql.gz',
        ]);
        expect(
          readFileSync(join(backupsDir, 'pre-update_20261014T000000Z_v1.4.0.sql.gz'), 'utf8'),
        ).toBe('newest');
        expect(readdirSync(legacyDir)).toHaveLength(3);
        // and they count: the newest is the way back, the retention sees them
        expect(t.latestBackup()).toBe('pre-update_20261014T000000Z_v1.4.0.sql.gz');
        // again: nothing to bring
        expect(t.importLegacy()).toEqual([]);
      });

      it('never overwrites a copy the folder already has', () => {
        mkdirSync(backupsDir, { recursive: true });
        writeFileSync(join(backupsDir, 'pre-update_20261001T000000Z_v1.0.0.sql.gz'), 'kept');
        legacy('pre-update_20261001T000000Z_v1.0.0.sql.gz', 'old');
        expect(withLegacy().importLegacy()).toEqual([]);
        expect(
          readFileSync(join(backupsDir, 'pre-update_20261001T000000Z_v1.0.0.sql.gz'), 'utf8'),
        ).toBe('kept');
      });

      it('goes on with the others when one cannot be copied, and leaves no partial file', () => {
        mkdirSync(join(legacyDir, 'pre-update_20261002T000000Z_v1.0.0.sql.gz')); // not a file: cannot be copied
        legacy('pre-update_20261014T000000Z_v1.5.0.sql.gz');
        expect(withLegacy().importLegacy()).toEqual(['pre-update_20261014T000000Z_v1.5.0.sql.gz']);
        expect(readdirSync(backupsDir)).toEqual(['pre-update_20261014T000000Z_v1.5.0.sql.gz']);
      });

      it('leaves no partial file and does not stop the start when the old volume is absent or empty', () => {
        expect(
          tools(fakeSpawn(() => ({})).spawn, { legacyDir: join(dir, 'none') }).importLegacy(),
        ).toEqual([]);
        expect(withLegacy().importLegacy()).toEqual([]);
        expect(existsSync(backupsDir)).toBe(false);
      });
    });

    it('has nothing to say when the folder does not exist yet', () => {
      expect(existsSync(backupsDir)).toBe(false);
      const t = tools(fakeSpawn(() => ({})).spawn);
      expect(t.latestBackup()).toBeNull();
      expect(() => t.prune()).not.toThrow();
    });
  });
});
