import { getConfig } from '@/config';
import { EVENTS_MODULE_KEY } from '@/config/schema';
import { emailsOfHolders } from '@/lib/notifications/recipients';
import { managePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { withDiscordCard } from '@/lib/notifications/discord-card';
import { withEmailContent } from '@/lib/notifications/email-card';
import { buildEventEmbed } from './discord-embed';
import { buildEventEmail } from './email';
import { buildReminderMessage } from './messages';
import { deliver, getTranslate, toNotificationData } from './notifications';
import { allOccurrences } from './recurrence';
import { addDays, fromLocalDateTime, toLocalDateTime } from './time';

const HOUR_MS = 3_600_000;
/** Occurrences starting further away than this cannot be due yet (the
 * reminder is sent the evening before, so at most ~30 hours ahead). */
const LOOKAHEAD_MS = 48 * HOUR_MS;

/** The instant the reminder for an occurrence becomes due: `reminderHour`:00
 * on the day before it starts, on the BDE's wall clock. */
export function reminderDueAt(occurrenceStart: Date, timeZone: string, reminderHour: number): Date {
  const local = toLocalDateTime(occurrenceStart, timeZone);
  const dayBefore = addDays(local, -1);
  return fromLocalDateTime({ ...dayBefore, hour: reminderHour, minute: 0 }, timeZone);
}

/** Whether two instants fall on the same calendar day on the BDE's wall clock. */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const [x, y] = [toLocalDateTime(a, timeZone), toLocalDateTime(b, timeZone)];
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export interface ReminderTickResult {
  /** Reminders this call claimed (and therefore attempted to send). */
  claimed: number;
}

/**
 * Sends the day-before reminders that are due. Safe to call at any frequency,
 * from any number of processes, and across restarts:
 *
 * - An occurrence is eligible once `reminderDueAt` has passed and until it
 *   starts, so an instance that was down at the usual time still catches up.
 * - Sending is guarded by inserting an `EventReminder` row whose unique key is
 *   (event, occurrence start). Only the caller whose insert succeeds sends, so
 *   a reminder is delivered at most once; if the process dies between the
 *   claim and the send, that reminder is lost rather than duplicated.
 * - Nothing is sent for drafts, cancelled occurrences, or events confirmed
 *   after the reminder was due (their confirmation notice just went out).
 */
export async function runReminderTick(now: Date = new Date()): Promise<ReminderTickResult> {
  const config = getConfig();
  const result: ReminderTickResult = { claimed: 0 };

  if (!config.events || !config.modules.enabled.includes('events')) {
    return result;
  }

  const { timezone: timeZone, defaultLocale: locale } = config.bde;
  const { reminderHour } = config.events;
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);

  const events = await prisma.event.findMany({
    where: {
      status: 'CONFIRMED',
      startsAt: { lt: horizon },
      OR: [{ recurrence: 'NONE', startsAt: { gt: now } }, { recurrence: { not: 'NONE' } }],
    },
    include: {
      assignees: { select: { login: true, user: { select: { fullName: true, email: true } } } },
      cancellations: { select: { occurrenceStart: true } },
    },
  });

  const translate = events.length > 0 ? await getTranslate(locale) : null;

  for (const event of events) {
    const cancelled = new Set(event.cancellations.map((c) => c.occurrenceStart.getTime()));

    for (const occurrence of allOccurrences(event, timeZone)) {
      const startMs = occurrence.start.getTime();
      if (startMs <= now.getTime() || startMs > horizon.getTime() || cancelled.has(startMs)) {
        continue;
      }

      const dueAt = reminderDueAt(occurrence.start, timeZone, reminderHour);
      if (dueAt.getTime() > now.getTime()) {
        continue;
      }
      // Confirmed after the reminder was due: members were just told about it.
      if (
        event.confirmationNotifiedAt &&
        event.confirmationNotifiedAt.getTime() > dueAt.getTime()
      ) {
        continue;
      }

      try {
        await prisma.eventReminder.create({
          data: { eventId: event.id, occurrenceStart: occurrence.start },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          continue; // already claimed — by a previous run or another instance
        }
        console.error('[events] eventReminder: could not claim reminder', error);
        continue;
      }

      result.claimed += 1;

      if (!translate) continue;
      // Normally tomorrow's; today's when the server was down at the usual time and this goes out late.
      const day = isSameLocalDay(occurrence.start, now, timeZone) ? 'today' : 'tomorrow';
      const data = toNotificationData(event, occurrence, locale);
      const message = await withEmailContent(
        'eventReminder',
        await withDiscordCard(
          'eventReminder',
          buildReminderMessage(data, translate, locale, timeZone, day),
          () => buildEventEmbed(day, data, translate, timeZone, now),
        ),
        (brand) => buildEventEmail(day, data, translate, locale, timeZone, brand),
      );
      const assigneeEmails = event.assignees.flatMap((a) => (a.user ? [a.user.email] : []));
      // Nobody in charge to write to: the people who run the events get it, so a reminder is never
      // sent to no one. (Looked up only when it is an email: a chat channel needs no recipient.)
      const emails =
        assigneeEmails.length === 0 && config.notifications.eventReminder === 'email'
          ? await emailsOfHolders(managePermission(EVENTS_MODULE_KEY))
          : assigneeEmails;
      await deliver('eventReminder', message, emails);
    }
  }

  return result;
}
