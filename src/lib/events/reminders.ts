import { getConfig } from '@/config';
import { channelsFor } from '@/config/schema';
import { emailsOfHolders } from '@/lib/notifications/recipients';
import { EVENTS_VALIDATE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { withRichMessage } from '@/lib/notifications/rich';
import { buildEventEmbed } from './discord-embed';
import { buildEventEmail } from './email';
import { buildReminderMessage } from './messages';
import { deliver, getTranslate, repeatSummaryFor, toNotificationData } from './notifications';
import { VISIBLE_WITHOUT_DRAFTS } from './include';
import { resolveOccurrences } from './series';
import { buildEventSlack } from './slack-blocks';
import { eventAbove } from './template-values';
import { templatesFor } from '@/lib/notifications/templates/resolve';
import { addDays, fromLocalDateTime, isSameLocalDay, toLocalDateTime } from './time';

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

  const assigneeSelect = {
    login: true,
    user: { select: { fullName: true, email: true } },
  } as const;
  const events = await prisma.event.findMany({
    where: {
      // A series can be confirmed with some dates back to draft, or a draft with some dates confirmed alone:
      // which date is reminded is decided date by date below.
      AND: [
        VISIBLE_WITHOUT_DRAFTS,
        {
          OR: [
            { startsAt: { lt: horizon } },
            { occurrences: { some: { startsAt: { lt: horizon } } } },
          ],
        },
        {
          OR: [
            { recurrenceUntil: { not: null } },
            { startsAt: { gt: now } },
            { occurrences: { some: { startsAt: { gt: now } } } },
          ],
        },
      ],
    },
    include: {
      assignees: { select: assigneeSelect },
      cancellations: { select: { occurrenceStart: true } },
      occurrences: { include: { assignees: { select: assigneeSelect } } },
    },
  });

  const translate = events.length > 0 ? await getTranslate(locale) : null;

  for (const event of events) {
    // The same for every date of the event: worked out once.
    const repeat = await repeatSummaryFor(event, locale);
    for (const occurrence of resolveOccurrences(event, timeZone)) {
      const startMs = occurrence.start.getTime();
      if (
        startMs <= now.getTime() ||
        startMs > horizon.getTime() ||
        occurrence.cancelled ||
        occurrence.status !== 'CONFIRMED'
      ) {
        continue;
      }

      const dueAt = reminderDueAt(occurrence.start, timeZone, reminderHour);
      if (dueAt.getTime() > now.getTime()) {
        continue;
      }
      // Confirmed after the reminder was due: members were just told about it.
      if (occurrence.announcedAt && occurrence.announcedAt.getTime() > dueAt.getTime()) {
        continue;
      }

      try {
        await prisma.eventReminder.create({
          // The key is where the series puts the date, so a date moved afterwards is still reminded once.
          data: { eventId: event.id, occurrenceStart: occurrence.originalStart },
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
      const data = toNotificationData(event, occurrence, locale, repeat);
      const templates = await templatesFor('eventReminder');
      const message = await withRichMessage(
        'eventReminder',
        buildReminderMessage(data, translate, locale, timeZone, day),
        {
          discord: () =>
            templates.build('discord', (context) =>
              buildEventEmbed(day, data, translate, timeZone, now, context),
            ),
          discordAbove: () =>
            templates.build('discord', (context) =>
              eventAbove('discord', day, data, translate, locale, timeZone, context),
            ),
          email: (brand) =>
            templates.build('email', (context) =>
              buildEventEmail(day, data, translate, locale, timeZone, brand, undefined, context),
            ),
          slack: (brand) =>
            templates.build('slack', (context) =>
              buildEventSlack(day, data, translate, locale, timeZone, brand, context),
            ),
        },
      );
      const assigneeEmails = occurrence.assignees.flatMap((a) =>
        a.user?.email ? [a.user.email] : [],
      );
      // Nobody in charge to write to: the people who run the events get it, so a reminder is never
      // sent to no one. (Looked up only when it is an email: a chat channel needs no recipient.)
      const emails =
        assigneeEmails.length === 0 && channelsFor(config, 'eventReminder').includes('email')
          ? await emailsOfHolders(EVENTS_VALIDATE)
          : assigneeEmails;
      await deliver('eventReminder', message, emails);
    }
  }

  return result;
}
