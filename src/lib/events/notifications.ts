import { getConfig } from '@/config';
import { channelsFor, type NotificationEvent } from '@/config/schema';
import { deliver as deliverNotification, type DeliveryResult } from '@/lib/notifications/deliver';
import { emailsOfHolders } from '@/lib/notifications/recipients';
import { withRichMessage } from '@/lib/notifications/rich';
import type { NotificationMessage } from '@/lib/notifications/types';
import { getNotificationTranslate } from '@/lib/notifications/translate';
import { APPROVED_STATUSES, EVENTS_VALIDATE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { buildEventEmbed } from './discord-embed';
import { buildEventEmail, buildEventIcs } from './email';
import { eventInclude } from './include';
import { resolveOccurrences, seriesKeyOf, type ResolvedOccurrence } from './series';
import { summarizeRepeat, summaryInputOf } from './repeat-summary';
import { buildEventSlack } from './slack-blocks';
import { eventAbove } from './template-values';
import { templatesFor } from '@/lib/notifications/templates/resolve';
import {
  buildConfirmationMessage,
  buildReviewMessage,
  type NotificationEventData,
  type Translate,
} from './messages';
import { registeredAddress } from '@/lib/public-address';

const LOG_PREFIX = '[events]';

/** Sends an events notification (see lib/notifications/deliver.ts). Never throws. */
export function deliver(
  event: Extract<
    NotificationEvent,
    'eventConfirmed' | 'eventReminder' | 'eventProposed' | 'eventApproved' | 'eventRefused'
  >,
  message: Omit<NotificationMessage, 'to'>,
  emailRecipients: readonly string[],
): Promise<DeliveryResult> {
  return deliverNotification(event, message, emailRecipients, LOG_PREFIX);
}

export function getTranslate(locale: string): Promise<Translate> {
  return getNotificationTranslate(locale, 'events.notifications');
}

/** The sentence that says how an event repeats, in the BDE's language ("Every 2 weeks on Monday and Wednesday, 10
 * times"), or null when it does not repeat. The same one as on the pages. */
export async function repeatSummaryFor(
  event: { repeat?: unknown; startsAt: Date; recurrenceUntil: Date | null },
  locale: string,
): Promise<string | null> {
  const input = summaryInputOf(event, getConfig().bde.timezone);
  if (!input) return null;
  return summarizeRepeat(
    input,
    await getNotificationTranslate(locale, 'events.repeat.summary'),
    locale,
  );
}

/** Absolute link to an event page, or null when APP_URL is not set. `originalStart` is the date's key (see
 * `ResolvedOccurrence.originalStart`), what the page puts in `?occ=`. */
export function eventUrl(locale: string, eventId: string, originalStart?: Date): string | null {
  const base = registeredAddress();
  if (!base) return null;
  const occurrence = originalStart ? `?occ=${originalStart.getTime()}` : '';
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
  repeat?: unknown;
  recurrenceUntil: Date | null;
  assignees: { login: string; user: { fullName: string } | null }[];
}

/** What a message needs about one date: its time, and the values it has of its own (title, place, members in
 * charge...) when it was edited alone; the event's otherwise. */
type DateOfEvent = { start: Date; end: Date; originalStart?: Date } & Partial<
  Pick<ResolvedOccurrence, 'title' | 'description' | 'location' | 'categoryKey' | 'assignees'>
>;

export function toNotificationData(
  event: LoadedEvent,
  occurrence: DateOfEvent,
  locale: string,
  /** How the event repeats, as `repeatSummaryFor` says it (null: it does not, or the date is told on its own). */
  repeat: string | null,
): NotificationEventData {
  const category = categoryOf(occurrence.categoryKey ?? event.categoryKey);
  return {
    eventId: event.id,
    title: occurrence.title ?? event.title,
    description: occurrence.description !== undefined ? occurrence.description : event.description,
    location: occurrence.location !== undefined ? occurrence.location : event.location,
    categoryLabel: category.label,
    categoryColor: category.color,
    assigneeNames: (occurrence.assignees ?? event.assignees).map(
      (a) => a.user?.fullName ?? a.login,
    ),
    start: occurrence.start,
    end: occurrence.end,
    repeat,
    url: eventUrl(locale, event.id, occurrence.originalStart ?? occurrence.start),
  };
}

const loadForAnnouncement = (eventId: string) =>
  prisma.event.findUnique({ where: { id: eventId }, include: eventInclude });

/**
 * Announces confirmed dates to every approved member, in ONE message: the card shows the next of them, the
 * calendar file carries all of those still to come. `onlyThisDate` is for a date confirmed alone, whose card must
 * not say that the event repeats.
 */
async function announce(
  event: NonNullable<Awaited<ReturnType<typeof loadForAnnouncement>>>,
  dates: readonly ResolvedOccurrence[],
  onlyThisDate: boolean,
): Promise<void> {
  const config = getConfig();
  const locale = config.bde.defaultLocale;
  const timeZone = config.bde.timezone;

  // Show the next date still to come (or the first one if all are past).
  const now = Date.now();
  const upcoming = dates.filter((d) => d.end.getTime() > now);
  const next = upcoming[0] ?? dates[0];
  if (!next) {
    return;
  }

  // A date confirmed alone is told as one date: its card does not say that the event repeats.
  const repeat = onlyThisDate ? null : await repeatSummaryFor(event, locale);
  const data = toNotificationData(event, next, locale, repeat);
  const translate = await getTranslate(locale);
  // The calendar file carries every date still to come (the next one, for a series that is over).
  const calendarDates = (upcoming.length > 0 ? upcoming : [next]).map((date) => ({
    originalStart: date.originalStart,
    start: date.start,
    end: date.end,
    title: date.title,
    description: date.description,
    location: date.location,
    category: categoryOf(date.categoryKey).label,
    updatedAt: date.updatedAt,
  }));

  const templates = await templatesFor('eventConfirmed');
  const message = await withRichMessage(
    'eventConfirmed',
    buildConfirmationMessage(data, translate, locale, timeZone),
    {
      discord: () =>
        templates.build('discord', (context) =>
          buildEventEmbed('confirmed', data, translate, timeZone, undefined, context),
        ),
      discordAbove: () =>
        templates.build('discord', (context) =>
          eventAbove('discord', 'confirmed', data, translate, locale, timeZone, context),
        ),
      email: (brand) =>
        templates.build('email', (context) =>
          buildEventEmail(
            'confirmed',
            data,
            translate,
            locale,
            timeZone,
            brand,
            buildEventIcs(seriesKeyOf(event), calendarDates, config.bde.name),
            context,
          ),
        ),
      slack: (brand) =>
        templates.build('slack', (context) =>
          buildEventSlack('confirmed', data, translate, locale, timeZone, brand, context),
        ),
    },
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
}

/**
 * Announces a newly confirmed event (or, for a series, a whole confirmed part of it: "confirm this date and the
 * following") to every approved member: one message, whatever the number of dates. The `confirmationNotifiedAt`
 * claim makes this fire at most once per event, so toggling DRAFT ↔ CONFIRMED never re-notifies. Never throws
 * and is meant to run after the response (see `after()` in the actions): saving an event can not fail because
 * a notification did.
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

    const event = await loadForAnnouncement(eventId);
    if (!event) {
      return;
    }
    const dates = resolveOccurrences(event, getConfig().bde.timezone).filter(
      (d) => !d.cancelled && d.status === 'CONFIRMED',
    );
    await announce(event, dates, false);
  } catch (error) {
    console.error(`${LOG_PREFIX} eventConfirmed: notification failed`, error);
  }
}

/**
 * Announces ONE date of a series that was confirmed on its own (the rest of the series is still a draft). Once
 * per date: the claim lives on the date's own row, which keeps it when the date goes back to draft and is
 * confirmed again. Same rules as `notifyEventConfirmed`: never throws, meant for `after()`.
 */
export async function notifyOccurrenceConfirmed(
  eventId: string,
  originalStart: Date,
): Promise<void> {
  try {
    const claim = await prisma.eventOccurrence.updateMany({
      where: {
        eventId,
        occurrenceStart: originalStart,
        status: 'CONFIRMED',
        confirmationNotifiedAt: null,
      },
      data: { confirmationNotifiedAt: new Date() },
    });
    if (claim.count === 0) {
      return;
    }

    const event = await loadForAnnouncement(eventId);
    if (!event) {
      return;
    }
    const date = resolveOccurrences(event, getConfig().bde.timezone).find(
      (d) => d.originalStart.getTime() === originalStart.getTime(),
    );
    if (!date || date.cancelled || date.status !== 'CONFIRMED') {
      return;
    }
    await announce(event, [date], true);
  } catch (error) {
    console.error(`${LOG_PREFIX} eventConfirmed: notification failed`, error);
  }
}

// ---- the proposal circuit ----------------------------------------------------------------------------------------

type ReviewKind = 'proposed' | 'approved' | 'refused';

const REVIEW_NOTIFICATION = {
  proposed: 'eventProposed',
  approved: 'eventApproved',
  refused: 'eventRefused',
} as const;

/** A member by name, the login when the account is gone. */
async function nameOf(login: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { login }, select: { fullName: true } });
  return user?.fullName ?? login;
}

/**
 * Tells about a step of the proposal circuit, in ONE message whatever the number of dates: the validators that an
 * event waits for them (`proposed`), the author that it was approved or refused (with the comment). The message
 * says what the event is *now*: if somebody acted again since (the proposal withdrawn, a second review), the
 * notice is stale and nothing is sent. A chat channel gets one team message, an e-mail goes to the people
 * concerned. Never throws and is meant to run after the response, like every notification.
 */
async function announceReview(
  kind: ReviewKind,
  eventId: string,
  actorLogin: string | null,
): Promise<void> {
  const key = REVIEW_NOTIFICATION[kind];
  try {
    const config = getConfig();
    const channels = channelsFor(config, key);
    if (channels.length === 0) return;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { ...eventInclude, author: { select: { fullName: true, email: true } } },
    });
    if (!event) return;
    const stillTrue =
      kind === 'proposed'
        ? event.status === 'PROPOSED'
        : kind === 'refused'
          ? event.status === 'DRAFT' && event.refusalComment !== null
          : true; // an approval is stale when no date is published any more: see `dates` below
    if (!stillTrue) return;

    const timeZone = config.bde.timezone;
    // An approval may be of one date alone: the card shows a date that was approved.
    const dates = resolveOccurrences(event, timeZone).filter(
      (d) => !d.cancelled && (kind !== 'approved' || d.status === 'CONFIRMED'),
    );
    const now = Date.now();
    const next = dates.find((d) => d.end.getTime() > now) ?? dates[0];
    if (!next) return;

    const locale = config.bde.defaultLocale;
    const data: NotificationEventData = {
      ...toNotificationData(event, next, locale, await repeatSummaryFor(event, locale)),
      review: {
        authorName: event.author?.fullName ?? event.authorLogin,
        reviewerName: kind === 'proposed' || !actorLogin ? null : await nameOf(actorLogin),
        comment: kind === 'refused' ? event.refusalComment : null,
      },
    };
    const translate = await getTranslate(locale);
    const templates = await templatesFor(key);
    const message = await withRichMessage(
      key,
      buildReviewMessage(kind, data, translate, locale, timeZone),
      {
        discord: () =>
          templates.build('discord', (context) =>
            buildEventEmbed(kind, data, translate, timeZone, undefined, context),
          ),
        discordAbove: () =>
          templates.build('discord', (context) =>
            eventAbove('discord', kind, data, translate, locale, timeZone, context),
          ),
        email: (brand) =>
          templates.build('email', (context) =>
            buildEventEmail(kind, data, translate, locale, timeZone, brand, undefined, context),
          ),
        slack: (brand) =>
          templates.build('slack', (context) =>
            buildEventSlack(kind, data, translate, locale, timeZone, brand, context),
          ),
      },
    );

    // Only an e-mail has recipients (a chat channel is one message for the team). The validators are told of a
    // proposal; the author of an answer, unless they gave it themselves (a validator who answers their own event).
    let recipients: string[] = [];
    if (channels.includes('email')) {
      const authorEmail =
        event.author?.email && event.authorLogin !== actorLogin ? [event.author.email] : [];
      recipients = kind === 'proposed' ? await emailsOfHolders(EVENTS_VALIDATE) : authorEmail;
    }
    await deliver(key, message, recipients);
  } catch (error) {
    console.error(`${LOG_PREFIX} ${key}: notification failed`, error);
  }
}

/** An event was proposed (or proposed again after a refusal): tells whoever can validate it. */
export const notifyEventProposed = (eventId: string) => announceReview('proposed', eventId, null);

/** A proposal was approved: tells its author (and, on a chat channel, the team). */
export const notifyEventApproved = (eventId: string, actorLogin: string) =>
  announceReview('approved', eventId, actorLogin);

/** A proposal was refused, with a comment: tells its author (and, on a chat channel, the team). */
export const notifyEventRefused = (eventId: string, actorLogin: string) =>
  announceReview('refused', eventId, actorLogin);
