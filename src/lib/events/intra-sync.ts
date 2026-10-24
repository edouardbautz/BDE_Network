import { createHash } from 'node:crypto';
import { getConfig } from '@/config';
import type { IntraRequest, Prisma } from '@/generated/prisma/client';
import { eventInclude } from './include';
import { intraPublicationEnabled } from './intra-config';
import {
  canonicalContent,
  intraReadiness,
  isOnIntra,
  readContent,
  sameContent,
  type IntraContent,
} from './intra-request';

// What the database does about the requests to publish on the intra (see "The staff publishes on the intra" in
// docs/architecture.md). Every function takes the transaction of its caller (`inSeriesTransaction`: SERIALIZABLE, retried), reads
// again inside it, and leaves the audit entry to the caller, written in the same transaction. The rules are in intra-request.ts.

type Tx = Prisma.TransactionClient;

export interface IntraActor {
  id: string;
  login: string;
}

/** What happened to a request because of a change to an event, for the caller to put in its audit entry and, later, to tell the staff. */
export type IntraOutcome =
  /** A request was made (or sent again after a refusal). */
  | { kind: 'requested'; eventId: string; title: string; resent: boolean }
  /** The event is on the intra and changed since: the staff has to update it. */
  | {
      kind: 'changed';
      eventId: string;
      title: string;
      before: IntraContent;
      after: IntraContent;
    }
  /** The request is gone because the event is no longer to be published (draft, deleted, no date left). `published`: it was on the intra. */
  | { kind: 'withdrawn'; eventId: string; title: string; published: IntraContent | null };

/** Why an answer was not taken, as the notice the page shows (`events.intra.notices.*`). */
export type IntraNotice =
  'gone' | 'alreadyAnswered' | 'changedMeanwhile' | 'notPublishable' | 'alreadyRequested';

export type IntraAnswer<T = Record<string, never>> =
  ({ ok: true } & T) | { ok: false; notice: IntraNotice };

export function hashContent(content: IntraContent): string {
  return createHash('sha256').update(canonicalContent(content)).digest('hex');
}

const timeZone = () => getConfig().bde.timezone;

async function loadEvent(tx: Tx, eventId: string) {
  return tx.event.findUnique({
    where: { id: eventId },
    include: { ...eventInclude, intraRequest: true },
  });
}

/** What the intra holds for a request that is on it (never null for a stored one: the database keeps the two together). */
function publishedOf(request: Pick<IntraRequest, 'publishedContent'>): IntraContent | null {
  return readContent(request.publishedContent);
}

/**
 * Brings the request of an event in line with the event as it is now, after something changed it. Idempotent (a hash of what
 * was last looked at). `create`: the event was just confirmed, or somebody asked for a request, so one is made when there is none.
 *
 * - no request and nothing to create: nothing;
 * - the event is no longer to be published (back to draft, every date cancelled): the request is removed;
 * - waiting or refused: it follows the event; nothing to tell;
 * - on the intra: still the same as what is there → published; otherwise → "to update", and that is an outcome.
 */
export async function syncIntraRequest(
  tx: Tx,
  eventId: string,
  options: { create?: IntraActor } = {},
): Promise<IntraOutcome[]> {
  if (!intraPublicationEnabled()) return [];
  const event = await loadEvent(tx, eventId);
  if (!event) return [];
  const request = event.intraRequest;
  const readiness = intraReadiness(event, timeZone());

  if (!request) {
    if (!options.create || !readiness.ok) return [];
    await tx.intraRequest.create({
      data: {
        eventId,
        contentHash: hashContent(readiness.content),
        requestedByLogin: options.create.login,
        requestedById: options.create.id,
      },
    });
    return [{ kind: 'requested', eventId, title: event.title, resent: false }];
  }

  if (!readiness.ok) {
    await tx.intraRequest.delete({ where: { id: request.id } });
    return [
      {
        kind: 'withdrawn',
        eventId,
        title: event.title,
        published: isOnIntra(request.status) ? publishedOf(request) : null,
      },
    ];
  }

  const hash = hashContent(readiness.content);
  if (hash === request.contentHash) return [];

  if (!isOnIntra(request.status)) {
    await tx.intraRequest.update({ where: { id: request.id }, data: { contentHash: hash } });
    return [];
  }
  const published = publishedOf(request);
  const unchanged = sameContent(published, readiness.content);
  await tx.intraRequest.update({
    where: { id: request.id },
    data: { contentHash: hash, status: unchanged ? 'PUBLISHED' : 'OUTDATED' },
  });
  if (unchanged || !published) return [];
  return [
    { kind: 'changed', eventId, title: event.title, before: published, after: readiness.content },
  ];
}

/** The same for several rows at once (a cut series has two), each once. */
export async function syncIntraRequests(
  tx: Tx,
  eventIds: readonly string[],
  options: { create?: IntraActor } = {},
): Promise<IntraOutcome[]> {
  const outcomes: IntraOutcome[] = [];
  for (const eventId of new Set(eventIds)) {
    outcomes.push(...(await syncIntraRequest(tx, eventId, options)));
  }
  return outcomes;
}

/** The event is about to be deleted (the request goes with it, by the foreign key): says what that means for the staff. */
export async function withdrawIntraRequest(tx: Tx, eventId: string): Promise<IntraOutcome[]> {
  if (!intraPublicationEnabled()) return [];
  const event = await loadEvent(tx, eventId);
  const request = event?.intraRequest;
  if (!event || !request) return [];
  return [
    {
      kind: 'withdrawn',
      eventId,
      title: event.title,
      published: isOnIntra(request.status) ? publishedOf(request) : null,
    },
  ];
}

/**
 * A series was cut in two rows: the second one continues the request of the first. What the intra holds for the dates from the
 * cut on is carried over (so that a change of those dates is shown as the old and the new), and when the intra holds nothing for
 * them, the new row is a request of its own. The caller then syncs both rows.
 */
export async function inheritIntraRequest(
  tx: Tx,
  parentId: string,
  tailId: string,
  cutAt: Date,
  actor: IntraActor,
): Promise<void> {
  if (!intraPublicationEnabled()) return;
  const parent = await tx.intraRequest.findUnique({ where: { eventId: parentId } });
  if (!parent) return;
  const published = isOnIntra(parent.status) ? publishedOf(parent) : null;
  const carried = published
    ? { ...published, dates: published.dates.filter((date) => new Date(date.start) >= cutAt) }
    : null;
  const common = {
    eventId: tailId,
    contentHash: parent.contentHash,
    requestedAt: parent.requestedAt,
    requestedByLogin: parent.requestedByLogin,
    requestedById: parent.requestedById,
  };
  if (carried && carried.dates.length > 0) {
    await tx.intraRequest.create({
      data: {
        ...common,
        status: parent.status,
        publishedContent: carried as unknown as Prisma.InputJsonValue,
        publishedAt: parent.publishedAt,
        intraUrl: parent.intraUrl,
        answeredAt: parent.answeredAt,
        answeredByLogin: parent.answeredByLogin,
        answeredById: parent.answeredById,
      },
    });
  } else if (parent.status === 'REFUSED') {
    await tx.intraRequest.create({
      data: {
        ...common,
        status: 'REFUSED',
        refusalComment: parent.refusalComment,
        answeredAt: parent.answeredAt,
        answeredByLogin: parent.answeredByLogin,
        answeredById: parent.answeredById,
      },
    });
  } else {
    // Waiting, or nothing of it on the intra: the new row is to be published like any other.
    await tx.intraRequest.create({
      data: { ...common, requestedAt: new Date(), requestedByLogin: actor.login, requestedById: actor.id },
    });
  }
}

// ---- the answers of the staff and the requests of the BDE ---------------------------------------------------------------

/** The content to publish now, or why not (the event is gone, or has nothing published any more). */
async function currentContent(tx: Tx, eventId: string) {
  const event = await loadEvent(tx, eventId);
  if (!event?.intraRequest) return { found: false as const };
  const readiness = intraReadiness(event, timeZone());
  if (!readiness.ok) return { found: false as const };
  return {
    found: true as const,
    event,
    request: event.intraRequest,
    content: readiness.content,
    hash: hashContent(readiness.content),
  };
}

/**
 * "Published on the intra": the request is answered with a copy of what was published, if it is the version the staff member
 * had in front of them (`expectedHash`: what the page showed) and nobody answered first. The link is optional.
 */
export async function publishRequest(
  tx: Tx,
  eventId: string,
  options: { expectedHash: string; url: string | null; actor: IntraActor },
): Promise<IntraAnswer<{ title: string; content: IntraContent }>> {
  const current = await currentContent(tx, eventId);
  if (!current.found) return { ok: false, notice: 'gone' };
  if (current.request.status !== 'PENDING') return { ok: false, notice: 'alreadyAnswered' };
  if (current.hash !== options.expectedHash) return { ok: false, notice: 'changedMeanwhile' };
  const now = new Date();
  const done = await tx.intraRequest.updateMany({
    where: { id: current.request.id, status: 'PENDING' },
    data: {
      status: 'PUBLISHED',
      contentHash: current.hash,
      publishedContent: current.content as unknown as Prisma.InputJsonValue,
      publishedAt: now,
      intraUrl: options.url,
      answeredAt: now,
      answeredByLogin: options.actor.login,
      answeredById: options.actor.id,
    },
  });
  if (done.count !== 1) return { ok: false, notice: 'alreadyAnswered' };
  return { ok: true, title: current.event.title, content: current.content };
}

/** "Intra updated": what is on the intra becomes the event as it is now (the version the staff member saw: `expectedHash`). */
export async function markRequestUpdated(
  tx: Tx,
  eventId: string,
  options: { expectedHash: string; actor: IntraActor },
): Promise<IntraAnswer<{ title: string; content: IntraContent }>> {
  const current = await currentContent(tx, eventId);
  if (!current.found) return { ok: false, notice: 'gone' };
  if (current.request.status !== 'OUTDATED') return { ok: false, notice: 'alreadyAnswered' };
  if (current.hash !== options.expectedHash) return { ok: false, notice: 'changedMeanwhile' };
  const now = new Date();
  const done = await tx.intraRequest.updateMany({
    where: { id: current.request.id, status: 'OUTDATED' },
    data: {
      status: 'PUBLISHED',
      contentHash: current.hash,
      publishedContent: current.content as unknown as Prisma.InputJsonValue,
      publishedAt: now,
      answeredAt: now,
      answeredByLogin: options.actor.login,
      answeredById: options.actor.id,
    },
  });
  if (done.count !== 1) return { ok: false, notice: 'alreadyAnswered' };
  return { ok: true, title: current.event.title, content: current.content };
}

/** A refusal, with the reason: only a request that is waiting can be refused (somebody answering first is a notice). */
export async function refuseRequest(
  tx: Tx,
  eventId: string,
  options: { comment: string; actor: IntraActor },
): Promise<IntraAnswer<{ title: string }>> {
  const event = await loadEvent(tx, eventId);
  const request = event?.intraRequest;
  if (!event || !request) return { ok: false, notice: 'gone' };
  if (request.status !== 'PENDING') return { ok: false, notice: 'alreadyAnswered' };
  const done = await tx.intraRequest.updateMany({
    where: { id: request.id, status: 'PENDING' },
    data: {
      status: 'REFUSED',
      refusalComment: options.comment,
      answeredAt: new Date(),
      answeredByLogin: options.actor.login,
      answeredById: options.actor.id,
    },
  });
  if (done.count !== 1) return { ok: false, notice: 'alreadyAnswered' };
  return { ok: true, title: event.title };
}

/**
 * Sends a request: again after a refusal, or for an event that is published and has none (confirmed before the platform
 * published on the intra, or whose request was taken back). One that waits or is on the intra is not sent twice.
 */
export async function sendRequest(
  tx: Tx,
  eventId: string,
  actor: IntraActor,
): Promise<IntraAnswer<{ title: string; resent: boolean }>> {
  const event = await loadEvent(tx, eventId);
  if (!event) return { ok: false, notice: 'gone' };
  const readiness = intraReadiness(event, timeZone());
  if (!readiness.ok) return { ok: false, notice: 'notPublishable' };
  const hash = hashContent(readiness.content);
  const request = event.intraRequest;
  if (!request) {
    await tx.intraRequest.create({
      data: { eventId, contentHash: hash, requestedByLogin: actor.login, requestedById: actor.id },
    });
    return { ok: true, title: event.title, resent: false };
  }
  if (request.status !== 'REFUSED') return { ok: false, notice: 'alreadyRequested' };
  await tx.intraRequest.update({
    where: { id: request.id },
    data: {
      status: 'PENDING',
      contentHash: hash,
      refusalComment: null,
      answeredAt: null,
      answeredByLogin: null,
      answeredById: null,
      requestedAt: new Date(),
      requestedByLogin: actor.login,
      requestedById: actor.id,
    },
  });
  return { ok: true, title: event.title, resent: true };
}
