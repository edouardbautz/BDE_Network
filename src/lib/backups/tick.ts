import type { BackupSituation } from './notifications/facts';
import { notifyBackups, type BackupNotification } from './notifications/send';
import { runBackup, type BackupContext, type BackupResult } from './run';
import { isDue, isStale, localDay, type AttemptTime } from './schedule';
import {
  lastSuccess,
  readStatus,
  writeStatus,
  type Attempt,
  type BackupStatus,
  type FailureCode,
} from './status';

/**
 * One look of the loop: tells the owners if no backup has succeeded for two days, makes the backup if one is due, and tells them if it
 * failed. **At most one message of each kind a day** (the day of the BDE), written in the status file before it is sent.
 *
 * What cannot be written down in the folder (it is the folder that is the problem: the rights of a rootless Docker, a read-only disk) is
 * remembered in memory for the life of the process, so that the retry spacing and the once-a-day rule hold there too, and the owners are
 * still told.
 */
export type Notify = (type: BackupNotification, situation: BackupSituation) => Promise<void>;

export type TickOutcome =
  | { ran: false; why: 'early' | 'done' | 'retry-later' | 'gave-up' }
  | { ran: true; result: BackupResult };

const DAY_MS = 86_400_000;

const volatile: { attempts: Attempt[]; alerts: BackupStatus['alerts'] } = {
  attempts: [],
  alerts: {},
};

/** For the tests: forgets what was only in memory. */
export function forgetVolatileState(): void {
  volatile.attempts = [];
  volatile.alerts = {};
}

const later = (a: string | undefined, b: string | undefined) =>
  a && b ? (a > b ? a : b) : (a ?? b);

/** The status file and what could not be written to it. */
async function readState(dir: string, now: Date): Promise<BackupStatus> {
  const status = await readStatus(dir, now);
  const horizon = now.getTime() - 2 * DAY_MS;
  volatile.attempts = volatile.attempts.filter((attempt) => Date.parse(attempt.at) >= horizon);
  const alerts = {
    failed: later(status.alerts.failed, volatile.alerts.failed),
    stale: later(status.alerts.stale, volatile.alerts.stale),
  };
  return {
    ...status,
    attempts: [...status.attempts, ...volatile.attempts].sort((a, b) => a.at.localeCompare(b.at)),
    alerts: {
      ...(alerts.failed && { failed: alerts.failed }),
      ...(alerts.stale && { stale: alerts.stale }),
    },
  };
}

async function markAlert(
  dir: string,
  now: Date,
  key: 'failed' | 'stale',
  day: string,
): Promise<void> {
  volatile.alerts[key] = day;
  try {
    const status = await readStatus(dir, now);
    await writeStatus(dir, { ...status, alerts: { ...status.alerts, [key]: day } });
  } catch {
    // the folder cannot be written: the memory holds it
  }
}

/** Telling the owners is best-effort: the backup loop goes on whatever happens to the message. */
async function tell(
  notify: Notify,
  type: BackupNotification,
  situation: BackupSituation,
): Promise<void> {
  try {
    await notify(type, situation);
  } catch (error) {
    console.error('[backups] the owners could not be told', error);
  }
}

const times = (attempts: readonly Attempt[]): AttemptTime[] =>
  attempts.map((attempt) => ({ at: new Date(attempt.at), ok: attempt.ok }));

function situationOf(status: BackupStatus, now: Date, code: FailureCode | null): BackupSituation {
  const success = lastSuccess(status);
  const lastAt = success ? new Date(success.at) : null;
  const reference = lastAt ?? new Date(status.since);
  const failure = [...status.attempts].reverse().find((attempt) => !attempt.ok);
  return {
    reasonCode: code ?? failure?.code ?? null,
    lastAt,
    lastBytes: success?.bytes ?? null,
    days: Math.max(0, Math.floor((now.getTime() - reference.getTime()) / DAY_MS)),
  };
}

export async function backupTick(
  context: BackupContext,
  notify: Notify = notifyBackups,
): Promise<TickOutcome> {
  const now = context.now();
  const day = localDay(now, context.timeZone);
  const status = await readState(context.dir, now);

  // No backup has succeeded for two days: said once a day for as long as it lasts.
  const success = lastSuccess(status);
  if (
    isStale({
      now,
      lastSuccessAt: success ? new Date(success.at) : null,
      since: new Date(status.since),
    }) &&
    status.alerts.stale !== day
  ) {
    await markAlert(context.dir, now, 'stale', day);
    await tell(notify, 'backupStale', situationOf(status, now, null));
  }

  const due = isDue({ now, timeZone: context.timeZone, attempts: times(status.attempts) });
  if (!due.due) return { ran: false, why: due.why };

  const result = await runBackup(context, 'scheduled');
  if (!result.ok && result.code !== 'busy') {
    if (result.code === 'folder') {
      volatile.attempts.push({
        at: now.toISOString(),
        ok: false,
        kind: 'scheduled',
        code: 'folder',
      });
    }
    // The first failure of the day is told at once; the retries that follow are not.
    const current = await readState(context.dir, now);
    if (current.alerts.failed !== day) {
      await markAlert(context.dir, now, 'failed', day);
      await tell(notify, 'backupFailed', situationOf(current, now, result.code));
    }
  }
  return { ran: true, result };
}
