import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { connectionOf } from './connection';
import { dumpIsWhole } from './dump';
import type { Exec } from './exec';
import { describeFolder, diagnoseFolder } from './folder';
import {
  DATABASE_FILE,
  INFO_FILE,
  LOGO_FILE,
  MANIFEST_FILE,
  SECRETS_FILE,
  SECRET_NAMES,
  sha256OfFile,
  type Manifest,
} from './manifest';
import { archiveName, parseArchiveName } from './names';
import { planRetention } from './retention';
import {
  lastSuccess,
  readStatus,
  record,
  writeStatus,
  type BackupStatus,
  type FailureCode,
  type Level,
} from './status';
import { VerificationError, verifyArchive } from './verify';

/**
 * One automatic backup, from start to finish: the dump of the database, the keys, the logo, a manifest, one archive, checked by
 * reading it again (verify.ts), then put in place and the old ones rotated (retention.ts). Whatever goes wrong, nothing half made stays
 * and the backups already there are not touched; the failure is written down for the owners (status.ts).
 */
export interface BackupContext {
  /** The folder of the backups (`BDE_BACKUP_DIR`; in the image, the host folder `./backups` of the compose file). */
  dir: string;
  /** The `secrets` volume, and the `uploads` volume (the logo). */
  secretsDir: string;
  uploadsDir: string;
  databaseUrl: string;
  timeZone: string;
  version: string;
  /** Where the keys come from when the `secrets` volume has none (a platform started with `docker run`). */
  env: Record<string, string | undefined>;
  exec: Exec;
  now: () => Date;
  /** Replaces the measure of the free space (the tests). */
  freeBytes?: (dir: string) => Promise<number | null>;
  log?: (line: string) => void;
}

/** The room left on the disk of the folder; null when it cannot be told (then the backup goes on and its own write says). */
async function freeBytesOf(dir: string): Promise<number | null> {
  return statfs(dir)
    .then((s) => s.bavail * s.bsize)
    .catch(() => null);
}

export type BackupResult =
  | { ok: true; name: string; bytes: number; level: Level; removed: string[] }
  | { ok: false; code: FailureCode | 'busy' };

class BackupError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

const LOCK_FILE = '.lock';
const LOCK_STALE_MS = 2 * 3_600_000;
const LEFTOVER_MS = 2 * 3_600_000;
const MIN_FREE_BYTES = 50 * 1024 * 1024;
const LOGO = /^logo-[a-f0-9]{16}$/;
const tmpId = () => randomBytes(4).toString('hex');

/** One backup at a time: an exclusive file. One left by a crash is taken over after two hours. */
async function acquireLock(dir: string, now: Date): Promise<(() => Promise<void>) | null> {
  const path = join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: now.toISOString() }));
      await handle.close();
      return async () => {
        await unlink(path).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age =
        now.getTime() -
        (await stat(path)
          .then((s) => s.mtimeMs)
          .catch(() => now.getTime()));
      if (age < LOCK_STALE_MS) return null;
      await unlink(path).catch(() => undefined);
    }
  }
  return null;
}

async function listArchives(dir: string) {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.flatMap((name) => {
    const at = parseArchiveName(name);
    return at ? [{ name, at }] : [];
  });
}

async function collectKeys(context: BackupContext, into: string): Promise<string[]> {
  await mkdir(into, { recursive: true, mode: 0o700 });
  const present: string[] = [];
  const fromEnv: Record<string, string | undefined> = {
    auth_secret: context.env.AUTH_SECRET,
    settings_key: context.env.SETTINGS_KEY,
  };
  for (const name of SECRET_NAMES) {
    const value =
      (await readFile(join(context.secretsDir, name), 'utf8').catch(() => '')).trim() ||
      fromEnv[name]?.trim();
    if (!value) continue;
    await writeFile(join(into, name), value, { mode: 0o600 });
    present.push(name);
  }
  return present;
}

async function create(context: BackupContext, status: BackupStatus, started: Date) {
  const { dir, exec } = context;
  const id = tmpId();
  const work = `.work-${id}`;
  const partial = `.partial-${id}.tar.gz`;
  const verifying = `.verify-${id}`;
  const name = archiveName(started);
  try {
    // 1. room for it
    const free = await (context.freeBytes ?? freeBytesOf)(dir);
    const previous = lastSuccess(status)?.bytes ?? 0;
    if (free !== null && free < Math.max(MIN_FREE_BYTES, 3 * previous)) {
      throw new BackupError('space', 'not enough room on the disk of the backups');
    }
    if ((await readdir(dir)).includes(name))
      throw new BackupError('archive', 'a backup of that second exists');
    await mkdir(join(dir, work), { recursive: true, mode: 0o700 });

    // 2. the database
    const connection = connectionOf(context.databaseUrl);
    const dump = await exec('pg_dump', ['--clean', '--if-exists'], {
      env: connection.env,
      stdoutFile: join(dir, work, DATABASE_FILE),
    });
    const whole = await dumpIsWhole(join(dir, work, DATABASE_FILE)).catch(() => false);
    if (dump.code !== 0 || !whole) {
      context.log?.(`pg_dump: ${dump.stderr.trim().slice(0, 300)}`);
      throw new BackupError('dump', 'the dump of the database failed or is incomplete');
    }

    // 3. the keys, and the logo
    const keys = await collectKeys(context, join(dir, work, 'keys'));
    if (keys.length === 0) throw new BackupError('secrets', 'no key to save');
    const made = await exec('tar', ['-cf', SECRETS_FILE, '-C', 'keys', ...keys], {
      cwd: join(dir, work),
    });
    if (made.code !== 0) throw new BackupError('secrets', 'the keys cannot be archived');
    await rm(join(dir, work, 'keys'), { recursive: true, force: true });

    const logos = (await readdir(context.uploadsDir).catch(() => [] as string[])).filter((file) =>
      LOGO.test(file),
    );
    if (logos.length > 0) {
      const logo = await exec('tar', ['-cf', LOGO_FILE, '-C', context.uploadsDir, ...logos], {
        cwd: join(dir, work),
      });
      if (logo.code !== 0) throw new BackupError('archive', 'the logo cannot be archived');
    }

    // 4. what is in it
    await writeFile(
      join(dir, work, INFO_FILE),
      `Sauvegarde BDE_Network (automatique)\nDate : ${started.toISOString()}\nVersion : ${context.version}\n`,
    );
    const files = [
      DATABASE_FILE,
      SECRETS_FILE,
      ...(logos.length > 0 ? [LOGO_FILE] : []),
      INFO_FILE,
    ];
    const manifest: Manifest = {
      format: 1,
      createdAt: started.toISOString(),
      version: context.version,
      timeZone: context.timeZone,
      secrets: true,
      logo: logos.length > 0,
      files: Object.fromEntries(
        await Promise.all(
          files.map(async (file) => [
            file,
            {
              bytes: (await stat(join(dir, work, file))).size,
              sha256: await sha256OfFile(join(dir, work, file)),
            },
          ]),
        ),
      ),
    };
    await writeFile(join(dir, work, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

    // 5. one archive, only for its owner
    const archived = await exec('tar', ['-czf', partial, '-C', work, ...files, MANIFEST_FILE], {
      cwd: dir,
    });
    if (archived.code !== 0) throw new BackupError('archive', 'the archive cannot be made');
    await chmod(join(dir, partial), 0o600);

    // 6. read again, not just written
    let verification;
    try {
      verification = await verifyArchive({
        archive: partial,
        cwd: dir,
        scratchDir: verifying,
        exec,
        connection,
      });
    } catch (error) {
      if (error instanceof VerificationError) {
        context.log?.(`verification: ${error.message}`);
        throw new BackupError(error.code, error.message);
      }
      throw error;
    }

    // 7. in place (a rename: the name appears whole or not at all)
    await rename(join(dir, partial), join(dir, name));
    const bytes = (await stat(join(dir, name))).size;
    return { name, bytes, level: verification.level };
  } finally {
    await rm(join(dir, work), { recursive: true, force: true }).catch(() => undefined);
    await rm(join(dir, partial), { force: true }).catch(() => undefined);
    await rm(join(dir, verifying), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Deletes what the rotation lets go, and the leftovers of a run that was killed. Never the newest, never a file that is not ours. */
export async function rotate(
  context: Pick<BackupContext, 'dir' | 'timeZone' | 'now'>,
): Promise<string[]> {
  const { dir } = context;
  const { remove } = planRetention(await listArchives(dir), context.timeZone);
  for (const name of remove) await unlink(join(dir, name)).catch(() => undefined);

  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!/^\.(work|partial|verify)-/.test(name)) continue;
    const age =
      context.now().getTime() -
      (await stat(join(dir, name))
        .then((s) => s.mtimeMs)
        .catch(() => context.now().getTime()));
    if (age > LEFTOVER_MS)
      await rm(join(dir, name), { recursive: true, force: true }).catch(() => undefined);
  }
  return remove;
}

export async function runBackup(
  context: BackupContext,
  kind: 'scheduled' | 'manual',
): Promise<BackupResult> {
  const started = context.now();
  let release: (() => Promise<void>) | null;
  try {
    await mkdir(context.dir, { recursive: true, mode: 0o700 });
    release = await acquireLock(context.dir, started);
  } catch (error) {
    // The folder cannot be made or written (rights of the host folder under a rootless Docker, a disk mounted read-only)
    const code = (error as NodeJS.ErrnoException).code ?? 'erreur';
    const folder = await diagnoseFolder(context.dir);
    context.log?.(
      `Sauvegarde impossible : le dossier des sauvegardes n'est pas utilisable (${code}). ${describeFolder({ ...folder, problem: folder.problem ?? 'notWritable', code: folder.code ?? code })}.`,
    );
    return { ok: false, code: 'folder' };
  }
  if (!release) return { ok: false, code: 'busy' };

  let status = await readStatus(context.dir, started);
  try {
    const made = await create(context, status, started);
    const removed = await rotate(context);
    status = record(status, {
      at: started.toISOString(),
      ok: true,
      kind,
      name: made.name,
      bytes: made.bytes,
      level: made.level,
    });
    await writeStatus(context.dir, status);
    context.log?.(
      `Sauvegarde ${made.name} faite (${made.bytes} octets, ${made.level === 'restored' ? 'relue dans une base de contrôle' : 'relue'}).`,
    );
    return { ok: true, ...made, removed };
  } catch (error) {
    const code: FailureCode = error instanceof BackupError ? error.code : 'unexpected';
    context.log?.(
      `Sauvegarde échouée (${code}) : ${error instanceof Error ? error.message : String(error)}`,
    );
    status = record(status, { at: started.toISOString(), ok: false, kind, code });
    await writeStatus(context.dir, status).catch(() => undefined);
    return { ok: false, code };
  } finally {
    await release();
  }
}
