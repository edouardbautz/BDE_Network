// The pure rules of a safe update, used by start.mjs and unit-tested (no process, no network, no disk).
// Plain JavaScript on purpose: it runs before the application, in an image that has `node` and nothing else.
//
// What an update has to guarantee, and how:
//   - the database the application finds is the one this image knows how to use (not a newer one, not one a failed
//     migration left half done): `planMigrations`;
//   - the image and docker-compose.yml belong together: `checkStack`;
//   - before migrations are applied, a copy of the database is kept, with a retention that never fills a disk:
//     `backupFileName`, `selectBackupsToDelete`;
//   - the database is reached the way the rest of the stack reaches it, whatever the address was written like:
//     `connectionEnv`.

/** What docker-compose.yml gives the image, as a number: the variables it sets, the volumes it mounts. Raised
 * when the two have to change together. docker-compose.yml passes it as `BDE_STACK`; a plain `docker run` (the CI,
 * a test) passes nothing and is not checked. */
export const STACK_VERSION = 3;

/** The compose file's number against this image's: null when they belong together (or when nothing says). */
export function checkStack(env) {
  const raw = String(env.BDE_STACK ?? '').trim();
  if (raw === '') return null;
  const stack = Number(raw);
  if (!Number.isInteger(stack) || stack < 1) return { kind: 'stack-old-image' };
  if (stack > STACK_VERSION) return { kind: 'stack-old-image' };
  if (stack < STACK_VERSION) return { kind: 'stack-old-compose' };
  return null;
}

/**
 * The libpq variables for a PostgreSQL address. `psql` and `pg_dump` cannot read the address Prisma uses
 * (`?schema=public` is not a libpq parameter), and a password written in it is encoded: it is decoded here, once,
 * and handed over in the environment (never on a command line, where `ps` would show it).
 */
export function connectionEnv(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) return null;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) return null;
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
}

/** `name|t|f` lines of the query on `_prisma_migrations`: { name, finished, rolledBack }. */
export function parseMigrationRows(output) {
  return String(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|'))
    .filter(
      ([name, finished, rolledBack]) =>
        name && /^[tf]$/.test(finished) && /^[tf]$/.test(rolledBack),
    )
    .map(([name, finished, rolledBack]) => ({
      name,
      finished: finished === 't',
      rolledBack: rolledBack === 't',
    }));
}

const SAFE_NAME = /^[0-9]{14}_[A-Za-z0-9_]{1,80}$/;

/**
 * What the database holds against what this image can apply.
 *
 *   fresh    nothing applied yet (a new installation): nothing to protect
 *   current  everything this image knows is applied
 *   pending  migrations to apply: the database is kept first
 *   newer    the database holds migrations this image does not have (an older image on a newer database)
 *   stuck    a migration failed in the past and was neither finished nor rolled back (Prisma refuses to go on)
 *
 * `applied` are the rows of `_prisma_migrations`; `known` the names of the folders of this image.
 */
export function planMigrations({ applied, known }) {
  const finished = applied.filter((row) => row.finished && !row.rolledBack);
  const failed = applied.filter((row) => !row.finished && !row.rolledBack).map((row) => row.name);
  const knownSet = new Set(known);
  const unknown = finished.map((row) => row.name).filter((name) => !knownSet.has(name));
  const appliedNames = new Set(finished.map((row) => row.name));
  const pending = known.filter((name) => !appliedNames.has(name));

  // Names go on a page and into a log: only what looks like a Prisma migration name does.
  const safe = (names) => names.filter((name) => SAFE_NAME.test(name)).slice(0, 5);

  if (applied.length === 0)
    return { state: 'fresh', pending: safe(pending), unknown: [], failed: [] };
  if (failed.length > 0)
    return { state: 'stuck', pending: safe(pending), unknown: [], failed: safe(failed) };
  if (unknown.length > 0)
    return { state: 'newer', pending: [], unknown: safe(unknown), failed: [] };
  if (pending.length > 0)
    return { state: 'pending', pending: safe(pending), unknown: [], failed: [] };
  return { state: 'current', pending: [], unknown: [], failed: [] };
}

// ---------------------------------------------------------------------------------------------
// The copies kept before an update

/** `pre-update_<UTC date>_v<version>.sql.gz` */
export const BACKUP_PATTERN = /^pre-update_(\d{8}T\d{6}Z)_v([0-9A-Za-z.+-]{1,40})\.sql\.gz$/;

export function backupFileName(date, version) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const safeVersion =
    String(version)
      .replace(/[^0-9A-Za-z.+-]/g, '')
      .slice(0, 40) || 'unknown';
  return `pre-update_${stamp}_v${safeVersion}.sql.gz`;
}

/** The instant a backup file was made, from its name: null when the name is not one of ours. */
export function backupDate(name) {
  const match = BACKUP_PATTERN.exec(name);
  if (!match) return null;
  const [, stamp] = match;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const BACKUPS_TO_KEEP = 5;
export const BACKUP_MAX_AGE_DAYS = 90;

/**
 * Which backups to delete: those beyond the newest `keep`, and those older than `maxAgeDays`: but never the newest
 * one (whatever its age, it is the way back), and never a file whose name is not one of ours.
 */
export function selectBackupsToDelete(
  names,
  { keep = BACKUPS_TO_KEEP, maxAgeDays = BACKUP_MAX_AGE_DAYS, now = new Date() } = {},
) {
  const ours = names
    .map((name) => ({ name, date: backupDate(name) }))
    .filter((entry) => entry.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const limit = now.getTime() - maxAgeDays * 86_400_000;
  return ours
    .filter((entry, index) => index > 0 && (index >= keep || entry.date.getTime() < limit))
    .map((entry) => entry.name);
}

/** The newest backup of a list of names, or null. */
export function newestBackup(names) {
  const ours = names
    .map((name) => ({ name, date: backupDate(name) }))
    .filter((entry) => entry.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return ours[0]?.name ?? null;
}
