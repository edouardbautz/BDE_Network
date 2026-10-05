import { createTranslator } from 'next-intl';
import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import { notify } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { allOccurrences } from './recurrence';
import {
  buildConfirmationMessage,
  type BuiltMessage,
  type NotificationEventData,
  type Translate,
} from './messages';

const LOG_PREFIX = '[events]';

interface DeliveryResult {
  sent: number;
  failed: number;
}

/**
 * Sends one message through the channel configured for `event`. Webhook
 * channels (Discord/Slack) get a single post; email gets one message per
 * recipient, each in its own try/catch so one bad address or a transient SMTP
 * error never prevents the others from being notified. Never throws: a
 * notification problem must not break the action that triggered it.
 */
export async function deliver(
  event: Extract<NotificationEvent, 'eventConfirmed' | 'eventReminder'>,
  message: BuiltMessage,
  emailRecipients: readonly string[],
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0 };

  try {
    const channel = getConfig().notifications[event];
    if (channel === 'none') {
      return result;
    }

    if (channel !== 'email') {
      try {
        await notify(event, message);
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        console.error(`${LOG_PREFIX} ${event}: ${channel} notification failed`, error);
      }
      return result;
    }

    for (const to of emailRecipients) {
      try {
        await notify(event, { ...message, to });
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        console.error(`${LOG_PREFIX} ${event}: email to a recipient failed`, error);
      }
    }
  } catch (error) {
    // Config or adapter selection problem — still must not propagate.
    console.error(`${LOG_PREFIX} ${event}: notification aborted`, error);
  }

  return result;
}

export async function getTranslate(locale: string): Promise<Translate> {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const translator = createTranslator({ locale, messages, namespace: 'events.notifications' });
  return (key, values) => (translator as unknown as Translate)(key, values);
}

/** Absolute link to an event page, or null when APP_URL is not set. */
export function eventUrl(locale: string, eventId: string, occurrenceStart?: Date): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (!base) return null;
  const occurrence = occurrenceStart ? `?occ=${occurrenceStart.getTime()}` : '';
  return `${base}/${locale}/events/${eventId}${occurrence}`;
}

function categoryLabelOf(categoryKey: string): string {
  const category = getConfig().events?.categories.find((c) => c.key === categoryKey);
  return category?.label ?? categoryKey;
}

interface LoadedEvent {
  id: string;
  title: string;
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
    location: event.location,
    categoryLabel: categoryLabelOf(event.categoryKey),
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

    const message = buildConfirmationMessage(
      toNotificationData(event, next, locale),
      await getTranslate(locale),
      locale,
      timeZone,
    );

    const members = await prisma.user.findMany({
      where: { role: { not: 'PENDING' } },
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
