import { join } from 'node:path';
import { getConfig } from '@/config';
import { uploadsDir } from '@/lib/branding/storage';
import { realExec } from './exec';
import { isDue, type AttemptTime } from './schedule';
import { runBackup, type BackupContext, type BackupResult } from './run';
import { readStatus, type Attempt } from './status';

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
