import { join } from 'node:path';
import { getConfig } from '@/config';
import { logAuditEvent } from '@/lib/audit-log';
import { uploadsDir } from '@/lib/branding/storage';
import { realExec } from './exec';
import { isDue, type AttemptTime } from './schedule';
import { runBackup, type BackupContext, type BackupResult } from './run';
import { readStatus, type Attempt, type FailureCode } from './status';

/**
 * Where the automatic backups go: `BDE_BACKUP_DIR` (`/auto-backups` in the image, a folder of the host in the compose file, so that they
 * survive `docker compose down -v`); `backups/` of the project outside Docker.
 */
export function backupDir(env: Record<string, string | undefined> = process.env): string {
  return env.BDE_BACKUP_DIR?.trim() || join(process.cwd(), 'backups');
}

export function secretsDir(env: Record<string, string | undefined> = process.env): string {
  return env.SECRETS_DIR?.trim() || '/secrets';
}

/** What a backup needs from the running platform. Null when it cannot be made (no database address). */
export function platformBackupContext(): BackupContext | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;
  return {
    dir: backupDir(),
    secretsDir: secretsDir(),
    uploadsDir: uploadsDir(),
    databaseUrl,
    timeZone: getConfig().bde.timezone,
    version: process.env.BDE_VERSION?.trim() || 'dev',
    env: { AUTH_SECRET: process.env.AUTH_SECRET, SETTINGS_KEY: process.env.SETTINGS_KEY },
    exec: realExec,
    now: () => new Date(),
    log: (line) => console.log(`💾 ${line}`),
  };
}

const times = (attempts: readonly Attempt[]): AttemptTime[] =>
  attempts.map((attempt) => ({ at: new Date(attempt.at), ok: attempt.ok }));

export type TickOutcome =
  | { ran: false; why: 'early' | 'done' | 'retry-later' | 'gave-up' }
  | { ran: true; result: BackupResult };

/** One look of the loop: makes the backup if one is due. Never throws. */
export async function backupTick(context: BackupContext): Promise<TickOutcome> {
  const now = context.now();
  const status = await readStatus(context.dir, now);
  const due = isDue({ now, timeZone: context.timeZone, attempts: times(status.attempts) });
  if (!due.due) return { ran: false, why: due.why };
  return { ran: true, result: await runBackup(context, 'scheduled') };
}

/** What a backup asked for by an owner came to: made, or why not (`busy`: another one is running; `unavailable`: no database address). */
export type ManualOutcome = 'made' | 'busy' | 'unavailable' | FailureCode;

/**
 * "Back up now", from the Settings page. The same backup as the nightly one (same checks, same rotation), written in the audit log with
 * who asked and what came of it. Never throws for a failed backup: that is an answer.
 */
export async function backupNow(actor: { login: string; id: string }): Promise<ManualOutcome> {
  const context = platformBackupContext();
  if (!context) return 'unavailable';
  const result = await runBackup(context, 'manual');
  const outcome: ManualOutcome = result.ok ? 'made' : result.code;
  if (outcome !== 'busy') {
    await logAuditEvent({
      actorLogin: actor.login,
      actorId: actor.id,
      action: 'backup.run',
      targetType: 'Backup',
      targetLabel: result.ok ? result.name : null,
      metadata: result.ok
        ? { ok: true, level: result.level, bytes: result.bytes }
        : { ok: false, reason: result.code },
    }).catch((error: unknown) =>
      console.error('[backups] the audit entry could not be written', error),
    );
  }
  return outcome;
}
