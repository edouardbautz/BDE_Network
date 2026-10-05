import { randomBytes } from 'node:crypto';
import { getConfig } from '@/config';
import { prisma } from '@/lib/prisma';
import { getUserModuleKeys, isApproved } from '@/lib/permissions';
import { canManageEvents, isEventsModuleEnabled } from './access';
import { buildIcs, occurrenceUid, type IcsEvent } from './ics';
import type { OccurrenceView } from './occurrences';
import { listOccurrences } from './queries';

const DAY_MS = 86_400_000;
/** The feed covers the recent past and the next ~14 months. */
const FEED_PAST_DAYS = 30;
const FEED_FUTURE_DAYS = 430;

/** 32 random bytes, base64url: 43 characters, ~256 bits of entropy. */
export const CALENDAR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateCalendarToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The member's current token, creating one on first use. */
export async function ensureCalendarToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { calendarToken: true },
  });
  if (user.calendarToken) {
    return user.calendarToken;
  }

  const calendarToken = generateCalendarToken();
  // Only fill an empty slot, so two simultaneous first visits agree on one token.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, calendarToken: null },
    data: { calendarToken },
  });
  if (count === 1) {
    return calendarToken;
  }
  const winner = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { calendarToken: true },
  });
  return winner.calendarToken ?? calendarToken;
}

/** Replaces the member's token; the previous link stops working immediately. */
export async function regenerateCalendarToken(userId: string): Promise<string> {
  const calendarToken = generateCalendarToken();
  await prisma.user.update({ where: { id: userId }, data: { calendarToken } });
  return calendarToken;
}

function categoryLabel(categoryKey: string): string {
  return getConfig().events?.categories.find((c) => c.key === categoryKey)?.label ?? categoryKey;
}

export function toIcsEvents(occurrences: readonly OccurrenceView[]): IcsEvent[] {
  return occurrences.map((occurrence) => ({
    uid: occurrenceUid(occurrence.eventId, occurrence.start),
    start: occurrence.start,
    end: occurrence.end,
    summary: occurrence.title,
    description: occurrence.description,
    location: occurrence.location,
    confirmed: occurrence.status === 'CONFIRMED',
    category: categoryLabel(occurrence.categoryKey),
    lastModified: occurrence.updatedAt,
  }));
}

export function buildCalendarIcs(occurrences: readonly OccurrenceView[], now?: Date): string {
  return buildIcs({ name: getConfig().bde.name, events: toIcsEvents(occurrences) }, now);
}

/**
 * The personal subscription feed for `token`, or null when the link must not
 * work: unknown token, module disabled, or an account that is no longer
 * approved. Visibility is recomputed on every request from the owner's
 * *current* role and permissions, so a revoked "events" permission hides
 * drafts and a removed member (whose row — and token — is gone) gets nothing,
 * immediately.
 */
export async function buildSubscriptionFeed(
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!CALENDAR_TOKEN_PATTERN.test(token) || !isEventsModuleEnabled()) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { calendarToken: token },
    select: { id: true, role: true },
  });
  if (!user || !isApproved(user.role)) {
    return null;
  }

  const includeDrafts = canManageEvents(user.role, await getUserModuleKeys(user.id));
  const occurrences = await listOccurrences({
    range: {
      from: new Date(now.getTime() - FEED_PAST_DAYS * DAY_MS),
      to: new Date(now.getTime() + FEED_FUTURE_DAYS * DAY_MS),
    },
    includeDrafts,
  });

  return buildCalendarIcs(occurrences, now);
}
