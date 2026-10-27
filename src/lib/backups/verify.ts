import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { settingsKey, unseal } from '@/lib/settings/crypto';
import { toDatabase, type Connection } from './connection';
import type { Exec } from './exec';
import {
  DATABASE_FILE,
  MANIFEST_FILE,
  SECRETS_FILE,
  parseManifest,
  sha256OfFile,
  type Manifest,
} from './manifest';
import type { FailureCode, Level } from './status';

/**
 * A backup is checked after it is made: it is read again, not just written.
 *
 * 1. **The archive**: it opens, holds exactly what its manifest lists, and each file has the SHA-256 the manifest gives.
 * 2. **The dump**: it ends with the line PostgreSQL writes when it is whole.
 * 3. **The database**: the dump is loaded into a scratch database (made for this and dropped after, whatever happens), in one transaction
 *    with the first error stopping it, and the migrations and the tables are looked at.
 * 4. **The keys**: the sealed settings of that scratch database are opened with the key found IN THE ARCHIVE (not with the one of the
 *    running platform). That is the proof that the archive and its keys go together, which is the thing nobody checks until the day it matters.
 *
 * A server that does not let the platform create a database (a managed PostgreSQL) gets steps 1 and 2 only, and says so (`level: 'read'`).
 */
export class VerificationError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Verification {
  level: Level;
  /** Migrations applied in the copy, and tables it holds (null when the copy was only read). */
  migrations: number | null;
  tables: number | null;
  /** Whether the sealed settings of the copy opened with the key of the archive (null: nothing was sealed, or it was only read). */
  sealedOpened: boolean | null;
}

const DUMP_FOOTER = 'PostgreSQL database dump complete';
const SAFE_NAME = /^[a-z0-9_]+$/;

/** What a name inside an archive may be: a plain file name, nothing that climbs out of the folder it is opened in. */
const plainName = (name: string) => /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith('.');

async function dumpIsWhole(path: string): Promise<boolean> {
  const size = (await stat(path)).size;
  const tail = (await readFile(path)).subarray(Math.max(0, size - 400)).toString('utf8');
  return tail.includes(DUMP_FOOTER);
}

export async function verifyArchive(options: {
  /** The archive, relative to `cwd`. */
  archive: string;
  /** The folder of the backups: where the tools run, so that every path they get is a relative one. */
  cwd: string;
  /** Where the archive is opened, relative to `cwd`; made empty here and removed after. */
  scratchDir: string;
  exec: Exec;
  connection: Connection;
}): Promise<Verification> {
  const { archive, cwd, scratchDir, exec, connection } = options;
  const opened = join(cwd, scratchDir);

  // 1. the archive
  const listing = await exec('tar', ['-tzf', archive], { cwd });
  if (listing.code !== 0)
    throw new VerificationError('verify-archive', 'the archive cannot be opened');
  const names = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\//, ''))
    .filter(Boolean);
  if (names.some((name) => !plainName(name))) {
    throw new VerificationError('verify-archive', 'the archive holds a path, not files');
  }
  await rm(opened, { recursive: true, force: true });
  await mkdir(opened, { recursive: true, mode: 0o700 });
  const extracted = await exec('tar', ['-xzf', archive, '-C', scratchDir], { cwd });
  if (extracted.code !== 0)
    throw new VerificationError('verify-archive', 'the archive cannot be extracted');

  let manifest: Manifest;
  try {
    manifest = parseManifest(await readFile(join(opened, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    throw new VerificationError(
      'verify-archive',
      error instanceof Error ? error.message : 'no manifest',
    );
  }
  const listed = Object.keys(manifest.files).sort();
  const present = names.filter((name) => name !== MANIFEST_FILE).sort();
  if (listed.join() !== present.join()) {
    throw new VerificationError(
      'verify-archive',
      'the archive does not hold what its manifest lists',
    );
  }
  for (const [name, entry] of Object.entries(manifest.files)) {
    const path = join(opened, name);
    if ((await stat(path)).size !== entry.bytes || (await sha256OfFile(path)) !== entry.sha256) {
      throw new VerificationError('verify-archive', `${name} is not what the manifest says`);
    }
  }

  // 2. the dump
  if (!(await dumpIsWhole(join(opened, DATABASE_FILE)))) {
    throw new VerificationError('verify-archive', 'the dump is not complete');
  }

  // 3. and 4. the database, and the keys
  const scratch = `bde_verify_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  if (!SAFE_NAME.test(scratch))
    throw new VerificationError('unexpected', 'the scratch name is unsafe');
  const maintenance = toDatabase(connection, 'postgres');
  const created = await exec(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-c', `CREATE DATABASE ${scratch}`],
    { env: maintenance.env },
  );
  if (created.code !== 0) {
    if (/permission denied/i.test(created.stderr)) {
      return { level: 'read', migrations: null, tables: null, sealedOpened: null };
    }
    throw new VerificationError('verify-restore', 'a scratch database could not be made');
  }

  const scratchEnv = toDatabase(connection, scratch).env;
  const ask = async (sql: string): Promise<string> => {
    const answer = await exec('psql', ['-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
      env: scratchEnv,
    });
    if (answer.code !== 0)
      throw new VerificationError('verify-restore', 'the copy cannot be asked');
    return answer.stdout.trim();
  };

  try {
    const loaded = await exec(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', DATABASE_FILE],
      { env: scratchEnv, cwd: opened, stdoutFile: join(opened, 'load.out') },
    );
    if (loaded.code !== 0) throw new VerificationError('verify-restore', 'the dump does not load');

    const migrations = Number(
      await ask('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'),
    );
    const tables = Number(
      await ask("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"),
    );
    if (!(migrations > 0) || !(tables > 0)) {
      throw new VerificationError('verify-restore', 'the copy holds no migration or no table');
    }

    const sealed = await ask('SELECT secrets FROM "PlatformSettings" LIMIT 1').catch(() => '');
    let sealedOpened: boolean | null = null;
    if (sealed) {
      sealedOpened = false;
      try {
        unseal(sealed, await keyOf(opened, exec));
        sealedOpened = true;
      } catch {
        throw new VerificationError(
          'verify-secrets',
          'the keys of the archive do not open its sealed settings',
        );
      }
    }
    return { level: 'restored', migrations, tables, sealedOpened };
  } finally {
    await exec('psql', ['-q', '-c', `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`], {
      env: maintenance.env,
    }).catch(() => undefined);
    await rm(opened, { recursive: true, force: true });
  }
}

/** The key that opens the sealed settings, read from the keys saved in the archive, the way the platform reads its own. */
async function keyOf(opened: string, exec: Exec): Promise<Buffer> {
  await mkdir(join(opened, 'keys'), { recursive: true });
  const extracted = await exec('tar', ['-xf', SECRETS_FILE, '-C', 'keys'], { cwd: opened }).catch(
    () => null,
  );
  if (!extracted || extracted.code !== 0) {
    throw new VerificationError('verify-secrets', 'the keys of the archive cannot be opened');
  }
  const read = async (name: string) =>
    (await readFile(join(opened, 'keys', name), 'utf8').catch(() => '')).trim();
  const [explicit, secret] = [await read('settings_key'), await read('auth_secret')];
  if (!explicit && !secret)
    throw new VerificationError('verify-secrets', 'the archive holds no key');
  return settingsKey({ SETTINGS_KEY: explicit || undefined, AUTH_SECRET: secret || undefined });
}
