import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArchiveName } from './names';
import { isStale } from './schedule';
import { readStatus, type Attempt, type FailureCode, type Level } from './status';

/**
 * What the Settings page says about the backups: read from the folder and from the status file next to them, never from the database
 * (the page must be able to say that the database is what failed).
 */
export interface BackupRow {
  name: string;
  at: Date;
  bytes: number;
  /** How far it was checked when it was made; null for one old enough to be gone from the status file. */
  level: Level | null;
  kind: 'scheduled' | 'manual' | null;
}

export interface BackupOverview {
  /** False when the folder cannot be read at all. */
  readable: boolean;
  /** The newest first. */
  backups: BackupRow[];
  /** The newest backup that passed its check: what "the last backup" means. */
  last: BackupRow | null;
  /** Failures since the last success (or in all, when there never was one), and the reason of the most recent. */
  failuresSince: number;
  lastFailure: { at: Date; code: FailureCode } | null;
  /** No backup succeeded for two days. */
  stale: boolean;
  /** When the platform first looked at its backups. */
  since: Date;
}

const rowOf = (name: string, bytes: number, attempts: readonly Attempt[]): BackupRow | null => {
  const at = parseArchiveName(name);
  if (!at) return null;
  const attempt = attempts.find((candidate) => candidate.ok && candidate.name === name);
  return { name, at, bytes, level: attempt?.level ?? null, kind: attempt?.kind ?? null };
};

export async function readOverview(dir: string, now: Date): Promise<BackupOverview> {
  const status = await readStatus(dir, now);
  const names = await readdir(dir).catch(() => null);
  const rows = (
    await Promise.all(
      (names ?? []).map(async (name) => {
        if (!parseArchiveName(name)) return null;
        const size = await stat(join(dir, name)).then(
          (info) => (info.isFile() ? info.size : null),
          () => null,
        );
        return size === null ? null : rowOf(name, size, status.attempts);
      }),
    )
  )
    .filter((row): row is BackupRow => row !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const succeeded = [...status.attempts].reverse().find((attempt) => attempt.ok);
  const lastSuccessAt = succeeded ? new Date(succeeded.at) : (rows[0]?.at ?? null);
  const sinceSuccess = succeeded
    ? status.attempts.slice(status.attempts.lastIndexOf(succeeded) + 1)
    : status.attempts;
  const failures = sinceSuccess.filter((attempt) => !attempt.ok);
  const lastFailed = failures.at(-1);

  return {
    readable: names !== null,
    backups: rows,
    last: rows[0] ?? null,
    failuresSince: failures.length,
    lastFailure: lastFailed?.code ? { at: new Date(lastFailed.at), code: lastFailed.code } : null,
    stale: isStale({ now, lastSuccessAt, since: new Date(status.since) }),
    since: new Date(status.since),
  };
}
