// What start.mjs does to the database around an update: look at the migrations, keep a copy before applying them,
// put the copy back if they fail. Plain JavaScript on purpose (the image has `node`, `psql` and `pg_dump`, nothing
// else), and every outside thing it touches is passed in, so the tests drive it with small fakes.
//
// Why `psql` and `pg_dump` and not a driver: the image carries no application code in this process (it must
// run when the application cannot), and the dump has to be the one `scripts/backup.sh` and `scripts/restore.sh`
// already read and write: the same tool, the same options.
import { spawn as nodeSpawn } from 'node:child_process';
import {
  createReadStream,
  copyFileSync,
  createWriteStream,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import {
  backupDate,
  backupFileName,
  connectionEnv,
  newestBackup,
  parseMigrationRows,
  planMigrations,
  selectBackupsToDelete,
} from './safe-update.mjs';

const MAX_OUTPUT = 16 * 1024;

/** Runs a command to its end: its exit code and what it printed (capped). `stdin` is a readable stream, if any. */
function capture(spawn, command, args, { env, stdin } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      env,
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => (stdout = (stdout + chunk).slice(-MAX_OUTPUT)));
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-MAX_OUTPUT)));
    child.on('error', (error) =>
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }),
    );
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (stdin) {
      child.stdin.on('error', () => {}); // psql may stop reading at the first error
      stdin.on('error', () => child.kill());
      stdin.pipe(child.stdin);
    }
  });
}

/** The end of a gzip file, uncompressed: a dump that was cut short has no "dump complete" line. */
async function tailOfGzip(path, bytes = 4096) {
  let tail = '';
  for await (const chunk of createReadStream(path).pipe(createGunzip())) {
    tail = (tail + chunk.toString('latin1')).slice(-bytes);
  }
  return tail;
}

export function createDatabaseTools({
  env,
  spawn = nodeSpawn,
  migrationsDir = '/app/prisma/migrations',
  // The copies made before an update live in the folder of the backups (a folder of the host, which `down -v` does not touch).
  backupsDir = env.BDE_BACKUPS_DIR || join(env.BDE_BACKUP_DIR || '/auto-backups', 'pre-update'),
  // Where the volume `backups` of the stacks before 4 is mounted (read only), to carry its copies over.
  legacyDir = env.BDE_LEGACY_BACKUPS_DIR || '/legacy-backups',
  version = env.BDE_VERSION || 'unknown',
  now = () => new Date(),
}) {
  const connection = connectionEnv(env.DATABASE_URL ?? '');
  const pgEnv = connection ? { ...process.env, ...connection } : null;

  const knownMigrations = () =>
    readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  const psql = (sql) =>
    capture(spawn, 'psql', ['-X', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env: pgEnv,
    });

  return {
    /** Whether the stack can reach a database at all (an address that cannot be built is a mismatch, not a retry). */
    hasAddress: () => connection !== null,

    /** What the database holds against what this image can apply: see `planMigrations`. */
    async inspect() {
      const table = await psql(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL`);
      if (table.code !== 0) return { state: 'unreachable', output: table.stderr };
      if (table.stdout.trim() !== 't') {
        return planMigrations({ applied: [], known: knownMigrations() });
      }
      const rows = await psql(
        'SELECT migration_name, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM _prisma_migrations ORDER BY migration_name',
      );
      if (rows.code !== 0) return { state: 'unreachable', output: rows.stderr };
      return planMigrations({ applied: parseMigrationRows(rows.stdout), known: knownMigrations() });
    },

    /** Dumps the database to `backupsDir`, checks the file is complete, and answers its name. Throws otherwise. */
    async backup() {
      mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
      const name = backupFileName(now(), version);
      const path = join(backupsDir, name);
      const partial = `${path}.partial`;
      try {
        const dump = spawn('pg_dump', ['--clean', '--if-exists', '--no-password'], {
          env: pgEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        dump.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-MAX_OUTPUT)));
        const exited = new Promise((resolve) => {
          dump.on('error', (error) => resolve({ code: 1, message: error.message }));
          dump.on('close', (code) => resolve({ code: code ?? 1 }));
        });
        await pipeline(dump.stdout, createGzip(), createWriteStream(partial, { mode: 0o600 }));
        const result = await exited;
        if (result.code !== 0) {
          throw new Error(`pg_dump exited with ${result.code}: ${result.message ?? stderr}`);
        }
        if (!(await tailOfGzip(partial)).includes('PostgreSQL database dump complete')) {
          throw new Error('the dump is incomplete');
        }
        renameSync(partial, path);
        return name;
      } catch (error) {
        rmSync(partial, { force: true });
        throw error;
      }
    },

    /**
     * Puts a copy back, replacing everything: the schema is dropped first, because a migration that failed halfway
     * may have added tables the copy does not know, and the next attempt would stop on "already exists". One
     * transaction: if it fails, the database is as it was.
     */
    async restore(name) {
      const path = join(backupsDir, name);
      statSync(path); // throws when the file is not there
      async function* input() {
        yield 'DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n';
        for await (const chunk of createReadStream(path).pipe(createGunzip())) yield chunk;
      }
      const result = await capture(
        spawn,
        'psql',
        ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-o', '/dev/null'],
        { env: pgEnv, stdin: Readable.from(input()) },
      );
      if (result.code !== 0) throw new Error(`psql exited with ${result.code}: ${result.stderr}`);
    },

    /**
     * Carries the copies of the old volume `backups` (stacks before 4) into the folder: the ones it does not have yet, never
     * overwriting, never deleting (the old volume is mounted read only). Answers the names it brought. Safe to repeat.
     */
    importLegacy() {
      const brought = [];
      const known = new Set(tryList(backupsDir));
      for (const name of tryList(legacyDir)) {
        if (backupDate(name) === null || known.has(name)) continue;
        mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
        const partial = join(backupsDir, `${name}.partial`);
        try {
          copyFileSync(join(legacyDir, name), partial);
          renameSync(partial, join(backupsDir, name));
          brought.push(name);
        } catch {
          rmSync(partial, { force: true });
        }
      }
      return brought;
    },

    backups: () => tryList(backupsDir),
    latestBackup: () => newestBackup(tryList(backupsDir)),

    /** Deletes what the retention says (see `selectBackupsToDelete`). */
    prune() {
      for (const name of selectBackupsToDelete(tryList(backupsDir), { now: now() })) {
        rmSync(join(backupsDir, name), { force: true });
      }
    },
  };
}

function tryList(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
