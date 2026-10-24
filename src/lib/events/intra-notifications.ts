import { getConfig } from '@/config';
import { channelsFor } from '@/config/schema';
import { deliver as deliverNotification } from '@/lib/notifications/deliver';
import { withRichMessage } from '@/lib/notifications/rich';
import type { Room } from '@/lib/notifications/rooms';
import { templatesFor } from '@/lib/notifications/templates/resolve';
import { registeredAddress } from '@/lib/public-address';
import { prisma } from '@/lib/prisma';
import { buildEventEmbed } from './discord-embed';
import { buildEventEmail } from './email';
import { eventInclude } from './include';
import { causeText, intraChangeLines, intraFacts, intraFieldLines } from './intra-facts';
import { staffAudience } from './intra-audience';
import { intraReadiness, type IntraContent } from './intra-request';
import type { IntraOutcome } from './intra-sync';
import {
  buildIntraMessage,
  type IntraFacts,
  type NotificationEventData,
  type Translate,
} from './messages';
import type { IntraCardKind } from './card-kind';
import { getTranslate } from './notifications';
import { buildEventSlack } from './slack-blocks';
import { eventAbove } from './template-values';

// The messages about the publication on the intra (see "The staff publishes on the intra" in docs/architecture.md): the staff is asked,
// told that what is on the intra changed or was taken back; the author and the BDE's room are told it was published or refused.
// Every one is best-effort and meant for `after()`, like every notification: it never throws, and a request that was answered or taken
// back since is not announced. The text of each is built from the content of the request (what the staff is shown), not from the event.

const LOG_PREFIX = '[events]';

/** What each kind is sent as (the key of `notifications` in the configuration), and to whom. */
const KEY = {
  intraRequested: 'intraRequested',
  intraChanged: 'intraChanged',
  intraCancelled: 'intraCancelled',
  intraPublished: 'intraPublished',
  intraRefused: 'intraRefused',
} as const satisfies Record<IntraCardKind, IntraCardKind>;

/** A person by name: the login when the account is gone. */
async function nameOf(login: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { login }, select: { fullName: true } });
  return user?.fullName ?? login;
}

/** The date the card shows: the next one still to come, or the first when they are all past. */
function shownDate(content: IntraContent): { start: Date; end: Date } {
  const now = Date.now();
  const dates = content.dates.map((date) => ({
    start: new Date(date.start),
    end: new Date(date.end),
  }));
  return dates.find((date) => date.end.getTime() > now) ?? dates[0]!;
}

/** The staff's page for a request, or their list; the event's own page for the author. */
function addressOf(locale: string, path: string): string | null {
  const base = registeredAddress();
  return base ? `${base}/${locale}${path}` : null;
}

/** What a card about this content says of the event. */
function dataFor(
  content: IntraContent,
  eventId: string,
  url: string | null,
  t: Translate,
  facts: IntraFacts,
): NotificationEventData {
  const { start, end } = shownDate(content);
  return {
    eventId,
    title: content.title,
    description: content.description || null,
    location: content.location || null,
    categoryLabel: '',
    categoryColor: null,
    assigneeNames: [],
    start,
    end,
    // A series says how many dates it has, the page of the request lists them.
    repeat: content.dates.length > 1 ? t('intra.dates', { count: content.dates.length }) : null,
    url,
    intra: facts,
  };
}

interface Audience {
  room: Room;
  /** The people the e-mail goes to (only asked for when e-mail is one of the channels). */
  emails: () => Promise<string[]>;
}

async function send(
  kind: IntraCardKind,
  content: IntraContent,
  eventId: string,
  path: string,
  makeFacts: (t: Translate) => Promise<IntraFacts> | IntraFacts,
  audience: Audience,
): Promise<void> {
  const key = KEY[kind];
  const config = getConfig();
  if (!config.events?.intraPublication) return;
  const channels = channelsFor(config, key);
  if (channels.length === 0) return;

  const locale = config.bde.defaultLocale;
  const timeZone = config.bde.timezone;
  const t = await getTranslate(locale);
  const data = dataFor(content, eventId, addressOf(locale, path), t, await makeFacts(t));
  const templates = await templatesFor(key);
  const message = await withRichMessage(key, buildIntraMessage(kind, data, t, locale, timeZone), {
    discord: () =>
      templates.build('discord', (context) =>
        buildEventEmbed(kind, data, t, timeZone, undefined, context),
      ),
    discordAbove: () =>
      templates.build('discord', (context) =>
        eventAbove('discord', kind, data, t, locale, timeZone, context),
      ),
    email: (brand) =>
      templates.build('email', (context) =>
        buildEventEmail(kind, data, t, locale, timeZone, brand, undefined, context),
      ),
    slack: (brand) =>
      templates.build('slack', (context) =>
        buildEventSlack(kind, data, t, locale, timeZone, brand, context),
      ),
  });
  const recipients = channels.includes('email') ? await audience.emails() : [];
  await deliverNotification(key, message, recipients, LOG_PREFIX, audience.room);
}

/** The staff: its room, and by e-mail the people who hold the right (the owners when nobody does). */
const STAFF: Audience = {
  room: 'staff',
  emails: async () => (await staffAudience()).emails,
};

async function guarded(what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`${LOG_PREFIX} ${what}: notification failed`, error);
  }
}

/** A request was made (or sent again): the staff is asked to publish the event. A request answered or taken back since is not announced. */
export function notifyIntraRequested(eventId: string, actorLogin: string): Promise<void> {
  return guarded('intraRequested', async () => {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { ...eventInclude, intraRequest: { select: { status: true } } },
    });
    if (!event || event.intraRequest?.status !== 'PENDING') return;
    const readiness = intraReadiness(event, getConfig().bde.timezone);
    if (!readiness.ok) return;
    const requester = await nameOf(actorLogin);
    await send(
      'intraRequested',
      readiness.content,
      eventId,
      `/events/intra/${eventId}`,
      (t) =>
        intraFacts({ requestedByName: requester, fields: intraFieldLines(readiness.content, t) }),
      STAFF,
    );
  });
}

/** An event that is on the intra changed: the staff gets what the intra holds and what the event is now. */
export function notifyIntraChanged(
  outcome: Extract<IntraOutcome, { kind: 'changed' }>,
  actorLogin: string,
): Promise<void> {
  return guarded('intraChanged', async () => {
    const actor = await nameOf(actorLogin);
    const timeZone = getConfig().bde.timezone;
    await send(
      'intraChanged',
      outcome.after,
      outcome.eventId,
      `/events/intra/${outcome.eventId}`,
      (t) =>
        intraFacts({
          actorName: actor,
          changes: intraChangeLines(outcome.before, outcome.after, t, timeZone),
        }),
      STAFF,
    );
  });
}

/** An event that was on the intra goes back to draft, is deleted or has no date left: the staff has to take it down. */
export function notifyIntraCancelled(
  outcome: Extract<IntraOutcome, { kind: 'withdrawn' }>,
  actorLogin: string,
): Promise<void> {
  return guarded('intraCancelled', async () => {
    // Nothing was on the intra: the staff never saw it as published, so there is nothing to take down.
    if (!outcome.published) return;
    const published = outcome.published;
    const actor = await nameOf(actorLogin);
    await send(
      'intraCancelled',
      published,
      outcome.eventId,
      '/events/intra',
      (t) => intraFacts({ actorName: actor, cause: causeText(outcome.cause, t) }),
      STAFF,
    );
  });
}

/** What the changes of an event told the staff, after the response: one message for each outcome that concerns it. */
export async function announceIntraOutcomes(
  outcomes: readonly IntraOutcome[],
  actorLogin: string,
): Promise<void> {
  for (const outcome of outcomes) {
    if (outcome.kind === 'requested') await notifyIntraRequested(outcome.eventId, actorLogin);
    else if (outcome.kind === 'changed') await notifyIntraChanged(outcome, actorLogin);
    else await notifyIntraCancelled(outcome, actorLogin);
  }
}

/** The staff answered: the author is told by e-mail, and the BDE's room (not the staff's: it is the BDE that is concerned). */
export function notifyIntraAnswered(
  kind: 'published' | 'refused',
  eventId: string,
  actorLogin: string,
): Promise<void> {
  const card = kind === 'published' ? 'intraPublished' : 'intraRefused';
  return guarded(card, async () => {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ...eventInclude,
        intraRequest: true,
        author: { select: { email: true } },
      },
    });
    const request = event?.intraRequest;
    // Answered again or taken back since: the notice is stale.
    if (!event || !request || request.status !== (kind === 'published' ? 'PUBLISHED' : 'REFUSED')) {
      return;
    }
    const readiness = intraReadiness(event, getConfig().bde.timezone);
    if (!readiness.ok) return;
    const actor = await nameOf(actorLogin);
    await send(
      card,
      readiness.content,
      eventId,
      `/events/${eventId}`,
      () =>
        intraFacts({
          actorName: actor,
          comment: kind === 'refused' ? request.refusalComment : null,
          intraUrl: kind === 'published' ? request.intraUrl : null,
        }),
      {
        room: 'bde',
        emails: async () => (event.author?.email ? [event.author.email] : []),
      },
    );
  });
}
