import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * What the platform remembers of its backups, in a file next to them (`.status.json`), not in the database: a backup is for the day the
 * database is gone, and its history must be readable then, and while the database is down. The file holds the last attempts, when the
 * platform first looked, and when the owners were last told (once a day, not on every tick).
 */
export type FailureCode =
  | 'folder'
  | 'lock'
  | 'space'
  | 'dump'
  | 'secrets'
  | 'archive'
  | 'verify-archive'
  | 'verify-restore'
  | 'verify-secrets'
  | 'unexpected';

export const FAILURE_CODES: readonly FailureCode[] = [
  'folder',
  'lock',
  'space',
  'dump',
  'secrets',
  'archive',
  'verify-archive',
  'verify-restore',
  'verify-secrets',
  'unexpected',
];

/** How far a backup was checked: put back into a scratch database and its secrets opened, or only read. */
export type Level = 'restored' | 'read';

export interface Attempt {
  /** ISO 8601, UTC. */
  at: string;
  ok: boolean;
  kind: 'scheduled' | 'manual';
  name?: string;
  bytes?: number;
  level?: Level;
  code?: FailureCode;
}

export interface BackupStatus {
  version: 1;
  /** The first time the platform looked at its backups: "no backup for two days" counts from it when there never was one. */
  since: string;
  attempts: Attempt[];
  /** The local days (YYYY-MM-DD) on which the owners were last told of a failure and of a missing backup. */
  alerts: { failed?: string; stale?: string };
}

export const STATUS_FILE = '.status.json';
const KEPT_ATTEMPTS = 40;

export function emptyStatus(now: Date): BackupStatus {
  return { version: 1, since: now.toISOString(), attempts: [], alerts: {} };
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** Reads the file; anything that is not a status (missing, cut, hand-edited) is a fresh one, never a crash. */
export function parseStatus(text: string, now: Date): BackupStatus {
  try {
    const raw = JSON.parse(text) as Partial<BackupStatus>;
    if (raw.version !== 1 || !isString(raw.since) || !Array.isArray(raw.attempts))
      return emptyStatus(now);
    const attempts = raw.attempts.filter(
      (attempt): attempt is Attempt =>
        typeof attempt === 'object' &&
        attempt !== null &&
        isString(attempt.at) &&
        !Number.isNaN(Date.parse(attempt.at)) &&
        typeof attempt.ok === 'boolean' &&
        (attempt.kind === 'scheduled' || attempt.kind === 'manual'),
    );
    const alerts = typeof raw.alerts === 'object' && raw.alerts !== null ? raw.alerts : {};
    return {
      version: 1,
      since: raw.since,
      attempts: attempts.slice(-KEPT_ATTEMPTS),
      alerts: {
        ...(isString(alerts.failed) ? { failed: alerts.failed } : {}),
        ...(isString(alerts.stale) ? { stale: alerts.stale } : {}),
      },
    };
  } catch {
    return emptyStatus(now);
  }
}

export async function readStatus(dir: string, now: Date): Promise<BackupStatus> {
  try {
    return parseStatus(await readFile(join(dir, STATUS_FILE), 'utf8'), now);
  } catch {
    return emptyStatus(now);
  }
}

/** Written whole and renamed: a reader never sees half a file, and a crash leaves the previous one. */
export async function writeStatus(dir: string, status: BackupStatus): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, STATUS_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  const trimmed: BackupStatus = { ...status, attempts: status.attempts.slice(-KEPT_ATTEMPTS) };
  await writeFile(temporary, `${JSON.stringify(trimmed, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export function lastSuccess(status: BackupStatus): Attempt | null {
  return [...status.attempts].reverse().find((attempt) => attempt.ok) ?? null;
}

export function record(status: BackupStatus, attempt: Attempt): BackupStatus {
  return { ...status, attempts: [...status.attempts, attempt].slice(-KEPT_ATTEMPTS) };
}
