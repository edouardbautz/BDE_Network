import { fromLocalDateTime, toLocalDateTime } from '@/lib/events/time';

/**
 * When an automatic backup is due: every night at 03:00 in the zone of the BDE, with nobody to start it.
 *
 * - **Due** from 03:00 on, as long as there is no successful backup since that 03:00 (one made by hand at 10:00 counts for the day; one
 *   made at 01:00 does not, the night's still comes). A platform that was switched off at 03:00 catches up when it is back, the same
 *   day, rather than waiting for the next night.
 * - A failure is tried again after 30 minutes, three times at most in a day: a disk that is full or a database that is down is not
 *   beaten on every tick, and the owners are told (notifications) rather than left to find out.
 */
export const BACKUP_HOUR = 3;
export const RETRY_AFTER_MS = 30 * 60_000;
export const MAX_FAILURES_PER_DAY = 3;
/** "No backup succeeded for 2 days": what the owners are told about. */
export const STALE_AFTER_MS = 2 * 24 * 3_600_000;

export interface AttemptTime {
  at: Date;
  ok: boolean;
}

/** The instant of today's 03:00 in the zone of the BDE. */
export function slotOf(now: Date, timeZone: string): Date {
  const local = toLocalDateTime(now, timeZone);
  return fromLocalDateTime({ ...local, hour: BACKUP_HOUR, minute: 0 }, timeZone);
}

export type Due = { due: true } | { due: false; why: 'early' | 'done' | 'retry-later' | 'gave-up' };

export function isDue(input: {
  now: Date;
  timeZone: string;
  attempts: readonly AttemptTime[];
}): Due {
  const slot = slotOf(input.now, input.timeZone);
  if (input.now.getTime() < slot.getTime()) return { due: false, why: 'early' };

  const sinceSlot = input.attempts.filter((attempt) => attempt.at.getTime() >= slot.getTime());
  if (sinceSlot.some((attempt) => attempt.ok)) return { due: false, why: 'done' };

  const failures = sinceSlot.filter((attempt) => !attempt.ok);
  if (failures.length >= MAX_FAILURES_PER_DAY) return { due: false, why: 'gave-up' };
  const last = failures.at(-1);
  if (last && input.now.getTime() - last.at.getTime() < RETRY_AFTER_MS) {
    return { due: false, why: 'retry-later' };
  }
  return { due: true };
}

/** No backup has succeeded for two days (or ever, once the platform is two days old): the owners are told. */
export function isStale(input: { now: Date; lastSuccessAt: Date | null; since: Date }): boolean {
  const reference = input.lastSuccessAt ?? input.since;
  return input.now.getTime() - reference.getTime() >= STALE_AFTER_MS;
}

/** The day of the BDE an instant falls in, `2026-10-27`: what "once a day" is counted in. */
export function localDay(now: Date, timeZone: string): string {
  const local = toLocalDateTime(now, timeZone);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${local.year}-${two(local.month)}-${two(local.day)}`;
}
