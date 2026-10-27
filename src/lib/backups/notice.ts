import { FAILURE_CODES, type FailureCode } from './status';

/**
 * What a manual backup came to, for the Settings page it comes back to (`?backup=`): `made`, or why not. A closed list, read back with
 * `readBackupNotice`: anything else in the address is ignored and never echoed.
 */
export const BACKUP_NOTICES = ['made', 'busy', 'unavailable', ...FAILURE_CODES] as const;

export type BackupNotice = (typeof BACKUP_NOTICES)[number];

export function readBackupNotice(value: string | string[] | undefined): BackupNotice | null {
  const notice = Array.isArray(value) ? value[0] : value;
  return BACKUP_NOTICES.find((known) => known === notice) ?? null;
}

export const isFailure = (notice: BackupNotice): notice is FailureCode =>
  (FAILURE_CODES as readonly string[]).includes(notice);
