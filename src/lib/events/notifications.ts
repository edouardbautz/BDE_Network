import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import { deliver as deliverNotification, type DeliveryResult } from '@/lib/notifications/deliver';
import { withDiscordCard } from '@/lib/notifications/discord-card';
import type { NotificationMessage } from '@/lib/notifications/types';
import { getNotificationTranslate } from '@/lib/notifications/translate';
import { APPROVED_STATUSES } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { buildEventEmbed } from './discord-embed';
import { allOccurrences } from './recurrence';
import { buildConfirmationMessage, type NotificationEventData, type Translate } from './messages';

const LOG_PREFIX = '[events]';

/** Sends an events notification (see lib/notifications/deliver.ts). Never throws. */
export function deliver(
  event: Extract<NotificationEvent, 'eventConfirmed' | 'eventReminder'>,
  message: Omit<NotificationMessage, 'to'>,
  emailRecipients: readonly string[],
): Promise<DeliveryResult> {
  return deliverNotification(event, message, emailRecipients, LOG_PREFIX);
}

export function getTranslate(locale: string): Promise<Translate> {
  return getNotificationTranslate(locale, 'events.notifications');
}

/** Absolute link to an event page, or null when APP_URL is not set. */
export function eventUrl(locale: string, eventId: string, occurrenceStart?: Date): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (!base) return null;
  const occurrence = occurrenceStart ? `?occ=${occurrenceStart.getTime()}` : '';
  return `${base}/${locale}/events/${eventId}${occurrence}`;
}

/** The category as the config defines it; a key that was removed since keeps its raw key, no colour. */
function categoryOf(categoryKey: string): { label: string; color: string | null } {
  const category = getConfig().events?.categories.find((c) => c.key === categoryKey);
  return { label: category?.label ?? categoryKey, color: category?.color ?? null };
}

interface LoadedEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  startsAt: Date;
  endsAt: Date;
  recurrence: NotificationEventData['recurrence'];
  recurrenceUntil: Date | null;
  assignees: { login: string; user: { fullName: string } | null }[];
}

export function toNotificationData(
  event: LoadedEvent,
  occurrence: { start: Date; end: Date },
  locale: string,
): NotificationEventData {
  return {
    eventId: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    categoryLabel: categoryOf(event.categoryKey).label,
    categoryColor: categoryOf(event.categoryKey).color,
    assigneeNames: event.assignees.map((a) => a.user?.fullName ?? a.login),
    start: occurrence.start,
    end: occurrence.end,
    recurrence: event.recurrence,
    recurrenceUntil: event.recurrenceUntil,
    url: eventUrl(locale, event.id, occurrence.start),
  };
}

/**
 * Announces a newly confirmed event to every approved member. The
 * `confirmationNotifiedAt` claim makes this fire at most once per event, so
 * toggling DRAFT ↔ CONFIRMED never re-notifies. Never throws and is meant to
 * run after the response (see `after()` in the actions): saving an event can
 * not fail because a notification did.
 */
export async function notifyEventConfirmed(eventId: string): Promise<void> {
  try {
    const claim = await prisma.event.updateMany({
      where: { id: eventId, status: 'CONFIRMED', confirmationNotifiedAt: null },
      data: { confirmationNotifiedAt: new Date() },
    });
    if (claim.count === 0) {
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { assignees: { select: { login: true, user: { select: { fullName: true } } } } },
    });
    if (!event) {
      return;
    }

    const config = getConfig();
    const locale = config.bde.defaultLocale;
    const timeZone = config.bde.timezone;

    // Show the next occurrence still to come (or the first one if all are past).
    const occurrences = allOccurrences(event, timeZone);
    const now = Date.now();
    const next = occurrences.find((o) => o.end.getTime() > now) ?? occurrences[0];
    if (!next) {
      return;
    }

    const data = toNotificationData(event, next, locale);
    const translate = await getTranslate(locale);
    const message = await withDiscordCard(
      'eventConfirmed',
      buildConfirmationMessage(data, translate, locale, timeZone),
      () => buildEventEmbed('confirmed', data, translate, timeZone),
    );

    const members = await prisma.user.findMany({
      where: { status: { in: [...APPROVED_STATUSES] } },
      select: { email: true },
    });

    await deliver(
      'eventConfirmed',
      message,
      members.map((m) => m.email),
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} eventConfirmed: notification failed`, error);
  }
}
