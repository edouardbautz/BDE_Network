import { toLocalDateTime } from '@/lib/events/time';

/**
 * Which automatic backups to keep: **7 daily, 4 weekly, 6 monthly**, counted in the days of the BDE.
 *
 * - daily: the newest backup of each of the 7 most recent days that have one;
 * - weekly: the OLDEST backup of each of the 4 most recent weeks (Monday to Sunday) that have one;
 * - monthly: the OLDEST backup of each of the 6 most recent months that have one.
 *
 * The oldest of a week or a month, not the newest, so that a backup chosen as the weekly or the monthly one stays it: with the newest,
 * the choice would move every night and a month's backup would be thrown away the day after the next one was made. A backup can be
 * several of these at once (the first of a month is also the first of its week, and often one of the last 7 days): it is kept once.
 * Counting the days that have a backup rather than the calendar means a server that was off for a week still keeps 7 days of backups.
 */
export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

export const RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 6 };

export type Reason = 'daily' | 'weekly' | 'monthly';

export interface Entry {
  name: string;
  at: Date;
}

export interface RetentionPlan {
  /** Every backup that stays, with what it is kept as. */
  keep: Map<string, Reason[]>;
  /** The names to delete, oldest first. */
  remove: string[];
}

const two = (value: number): string => String(value).padStart(2, '0');

/** `2026-10-27`, `2026-W44` (the Monday that starts the week), `2026-10`, in the zone of the BDE. */
function keysOf(at: Date, timeZone: string): { day: string; week: string; month: string } {
  const local = toLocalDateTime(at, timeZone);
  const day = `${local.year}-${two(local.month)}-${two(local.day)}`;
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - sinceMonday * 86_400_000);
  const week = `${monday.getUTCFullYear()}-${two(monday.getUTCMonth() + 1)}-${two(monday.getUTCDate())}`;
  return { day, week, month: `${local.year}-${two(local.month)}` };
}

export function planRetention(
  entries: readonly Entry[],
  timeZone: string,
  policy: RetentionPolicy = RETENTION,
): RetentionPlan {
  const byTime = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime());
  const keep = new Map<string, Reason[]>();
  const add = (name: string, reason: Reason) => {
    const reasons = keep.get(name) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    keep.set(name, reasons);
  };

  // period key → the entries of that period, oldest first
  const group = (key: 'day' | 'week' | 'month') => {
    const groups = new Map<string, Entry[]>();
    for (const entry of byTime) {
      const period = keysOf(entry.at, timeZone)[key];
      groups.set(period, [...(groups.get(period) ?? []), entry]);
    }
    // the most recent periods first (the keys sort as dates do)
    return [...groups].sort(([a], [b]) => (a < b ? 1 : -1)).map(([, list]) => list);
  };

  for (const list of group('day').slice(0, policy.daily)) add(list[list.length - 1]!.name, 'daily');
  for (const list of group('week').slice(0, policy.weekly)) add(list[0]!.name, 'weekly');
  for (const list of group('month').slice(0, policy.monthly)) add(list[0]!.name, 'monthly');

  return {
    keep,
    remove: byTime.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name),
  };
}
