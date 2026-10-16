'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getLocale } from 'next-intl/server';
import { getConfig } from '@/config';
import type { EventStatus, Prisma } from '@/generated/prisma/client';
import { getPathname, redirect } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { prisma } from '@/lib/prisma';
import {
  requireEventsProposer,
  requireEventsValidator,
  type EventsAccess,
} from '@/lib/events/access';
import { APPROVED_STATUSES } from '@/lib/permissions';
import { auditEventAction, seriesAuditFields } from '@/lib/events/audit';
import {
  EVENT_STATUSES,
  parseEventInput,
  toEventRow,
  type EventFormErrors,
  type RawEventInput,
} from '@/lib/events/input';
import { eventInclude } from '@/lib/events/include';
import {
  notifyEventApproved,
  notifyEventConfirmed,
  notifyEventProposed,
  notifyEventRefused,
  notifyOccurrenceConfirmed,
} from '@/lib/events/notifications';
import { isOccurrenceStart } from '@/lib/events/recurrence';
import { isRepeating, readRepeatRule } from '@/lib/events/repeat';
import { repeatColumn } from '@/lib/events/repeat-column';
import { NO_REPEAT } from '@/lib/events/repeat-input';
import {
  canChangeStatus,
  canCreateWithStatus,
  canDeleteEvent,
  canEditEvent,
  parseRefusalComment,
  reviewActorOf,
  statusMove,
  type ReviewedEvent,
  type StatusMove,
} from '@/lib/events/review';
import {
  SeriesError,
  deleteFollowing,
  resolvedAt,
  updateFollowing,
  updateOccurrence,
  type DateChange,
} from '@/lib/events/series-operations';
import { isSeriesScope, type SeriesScope } from '@/lib/events/series';
import { inSeriesTransaction } from '@/lib/events/transaction';

export interface EventFormState {
  errors?: EventFormErrors;
  /** Keys of `events.form.formErrors.*`. */
  formError?: 'invalidAssignee' | 'notFound';
  /** Submitted values, so a rejected form keeps what the user typed. */
  values?: RawEventInput;
}

function readRawInput(formData: FormData): RawEventInput {
  const text = (name: string) => String(formData.get(name) ?? '');
  return {
    title: text('title'),
    description: text('description'),
    location: text('location'),
    categoryKey: text('categoryKey'),
    startsAt: text('startsAt'),
    endsAt: text('endsAt'),
    status: text('status'),
    repeat: text('repeat'),
    repeatFreq: text('repeatFreq'),
    repeatInterval: text('repeatInterval'),
    repeatWeekdays: formData.getAll('repeatWeekdays').map(String),
    repeatMonthly: text('repeatMonthly'),
    repeatMonthDay: text('repeatMonthDay'),
    repeatEnd: text('repeatEnd'),
    recurrenceUntil: text('recurrenceUntil'),
    repeatCount: text('repeatCount'),
    assigneeLogins: formData.getAll('assignees').map(String),
  };
}

function formConfig() {
  const config = getConfig();
  return {
    timeZone: config.bde.timezone,
    categoryKeys: (config.events?.categories ?? []).map((category) => category.key),
  };
}

/** Announces a confirmed event (or the confirmed part of a series) after the response is sent. The notification
 * layer never throws, and this wrapper makes sure nothing it does — not even an unexpected rejection — can fail
 * or delay saving the event. */
function announceConfirmation(eventId: string): void {
  after(async () => {
    try {
      await notifyEventConfirmed(eventId);
    } catch (error) {
      console.error('[events] confirmation notice failed', error);
    }
  });
}

/** The same, for one date of a series confirmed on its own. */
function announceOccurrence(eventId: string, originalStart: Date): void {
  after(async () => {
    try {
      await notifyOccurrenceConfirmed(eventId, originalStart);
    } catch (error) {
      console.error('[events] confirmation notice failed', error);
    }
  });
}

/** The same, for the proposal circuit: whoever can validate is told that an event waits for them. */
function announceProposal(eventId: string): void {
  after(async () => {
    try {
      await notifyEventProposed(eventId);
    } catch (error) {
      console.error('[events] proposal notice failed', error);
    }
  });
}

/** The author is told that their proposal was approved (or refused: see `refuseEvent`). */
function announceApproval(eventId: string, actorLogin: string): void {
  after(async () => {
    try {
      await notifyEventApproved(eventId, actorLogin);
    } catch (error) {
      console.error('[events] approval notice failed', error);
    }
  });
}

/** What a status change sets off after the response: the members are told of an event that became public, the
 * validators of a proposal, the author of an approval. `scope`, `eventId` and `ownStatus` are what the series
 * operation answered (see updateEvent and setEventStatus). */
function announceStatusChange(options: {
  move: StatusMove;
  to: EventStatus;
  scope: SeriesScope;
  eventId: string;
  occurrenceStart: Date;
  ownStatus: EventStatus | null;
  actorLogin: string;
}): void {
  const { move, to, scope, eventId, occurrenceStart, ownStatus, actorLogin } = options;
  if (move === 'propose') announceProposal(eventId);
  if (move === 'approve') announceApproval(eventId, actorLogin);
  if (to === 'CONFIRMED') {
    if (scope === 'following') {
      announceConfirmation(eventId);
    } else if (ownStatus === 'CONFIRMED') {
      // A date that is simply confirmed again, like the rest of its series, has nothing to announce.
      announceOccurrence(eventId, occurrenceStart);
    }
  }
}

/** What the rules of the circuit (lib/events/review.ts) need to know about a stored event. */
function reviewedView(event: {
  status: EventStatus;
  authorLogin: string;
  occurrences: readonly { status: EventStatus | null }[];
}): ReviewedEvent {
  return {
    status: event.status,
    authorLogin: event.authorLogin,
    dateStatuses: event.occurrences.map((own) => own.status),
  };
}

/** The audit action of a status change: a proposal, a withdrawal and an approval have their own. */
const STATUS_AUDIT_ACTION = {
  propose: 'event.propose',
  withdraw: 'event.withdraw',
  approve: 'event.approve',
  status_change: 'event.status_change',
} as const;

/** When the dates of a row become proposed or confirmed, the refusal that was on them is over, and a proposal
 * says when it was made. (Only a change of the row itself: one date confirmed alone leaves the rest as it was.) */
async function settleReviewMarkers(
  tx: Prisma.TransactionClient,
  eventId: string,
  to: EventStatus,
): Promise<void> {
  if (to === 'DRAFT') return;
  await tx.event.update({
    where: { id: eventId },
    data: {
      refusalComment: null,
      refusedByLogin: null,
      refusedAt: null,
      ...(to === 'PROPOSED' ? { proposedAt: new Date() } : {}),
    },
  });
}

/** The check made again inside the transaction, against the event as it is then: somebody who may not publish
 * must not edit an event that a validator published since the page was drawn. */
async function assertMayEdit(
  tx: Prisma.TransactionClient,
  access: EventsAccess,
  eventId: string,
): Promise<void> {
  if (access.canValidate) return;
  const fresh = await tx.event.findUnique({ where: { id: eventId }, include: eventInclude });
  if (!fresh || !canEditEvent(reviewActorOf(access), reviewedView(fresh))) {
    throw new Error('Forbidden');
  }
}

/** Resolves the requested logins to approved accounts, or null if any is unknown. */
async function resolveAssignees(logins: string[]) {
  if (logins.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { login: { in: logins }, status: { in: [...APPROVED_STATUSES] } },
    select: { id: true, login: true },
  });
  return users.length === logins.length ? users : null;
}

export async function createEvent(
  _previous: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const access = await requireEventsProposer();
  const raw = readRawInput(formData);

  const parsed = parseEventInput(raw, formConfig());
  if (!parsed.ok) {
    return { errors: parsed.errors, values: raw };
  }
  // The form only offers what the person may choose: anything else is a crafted request. A proposer can
  // never create a confirmed event.
  if (!canCreateWithStatus(reviewActorOf(access), parsed.data.status)) {
    throw new Error('Forbidden');
  }

  const assignees = await resolveAssignees(parsed.data.assigneeLogins);
  if (!assignees) {
    return { formError: 'invalidAssignee', values: raw };
  }

  const data = toEventRow(parsed.data);
  const { user } = access.session;

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        ...data,
        repeat: repeatColumn(data.repeat),
        authorLogin: user.login,
        authorId: user.id,
        ...(data.status === 'PROPOSED' ? { proposedAt: new Date() } : {}),
        assignees: { create: assignees.map((a) => ({ login: a.login, userId: a.id })) },
      },
    });
    await auditEventAction(
      access,
      'event.create',
      created,
      { status: created.status, recurrence: readRepeatRule(created.repeat)?.freq ?? 'NONE' },
      tx,
    );
    if (created.status === 'PROPOSED') {
      await auditEventAction(access, 'event.propose', created, { created: true }, tx);
    }
    return created;
  });

  if (event.status === 'CONFIRMED') {
    announceConfirmation(event.id);
  }
  if (event.status === 'PROPOSED') {
    announceProposal(event.id);
  }

  revalidatePath('/events');
  redirect({ href: `/events/${event.id}`, locale: await getLocale() });
  return {};
}

// ---- what a series changes in an action ---------------------------------------------------------------------------

type Notice = 'eventGone' | 'occurrenceGone' | 'seriesBusy' | 'alreadyReviewed';

/** The address of an events page, with its language prefix and query string. */
async function addressOf(
  href: string | { pathname: string; query: Record<string, string | number> },
): Promise<string> {
  return getPathname({ href, locale: await getLocale() });
}

/** Where a person goes when what they asked for is gone or was changed by somebody else at the same moment (see
 * lib/events/notice.ts): the list for an event that is gone, the event for a date or a busy series. */
function noticeHref(eventId: string, notice: Notice) {
  return notice === 'eventGone'
    ? { pathname: '/events', query: { notice } }
    : { pathname: `/events/${eventId}`, query: { notice } };
}

/** For a form, which leaves the page it is on: a redirect is fine. */
async function redirectWithNotice(eventId: string, notice: Notice): Promise<never> {
  return redirect({ href: noticeHref(eventId, notice), locale: await getLocale() });
}

/** The event was deleted by someone else while this page was open: not a failure, so go back to
 * the list and say so (see lib/events/notice.ts). */
async function eventGone(): Promise<never> {
  return redirectWithNotice('', 'eventGone');
}

/** `occurrence` travels as the date's start in epoch milliseconds (the key of the date, see
 * `ResolvedOccurrence.originalStart`). */
function readOccurrence(value: FormDataEntryValue | number | null | undefined): Date | null {
  const ms = Number(value);
  return typeof value !== 'object' && value !== null && Number.isFinite(ms) && ms > 0
    ? new Date(ms)
    : null;
}

/** An unknown scope is a crafted request, not something to explain nicely. */
function requireScope(value: unknown): SeriesScope {
  if (!isSeriesScope(value)) throw new Error('Invalid scope');
  return value;
}

type SeriesOutcome<T> = { ok: true; value: T } | { ok: false; notice: Notice };

/** Runs the work of a series in its transaction (retried when two people act at once). What turned out to be gone
 * or busy comes back as a notice for the caller to show, never thrown. */
async function inSeries<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<SeriesOutcome<T>> {
  try {
    const value = await inSeriesTransaction(work);
    return value === null ? { ok: false, notice: 'seriesBusy' } : { ok: true, value };
  } catch (error) {
    if (error instanceof SeriesError) return { ok: false, notice: error.code };
    throw error;
  }
}

export async function updateEvent(
  eventId: string,
  _previous: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const access = await requireEventsProposer();
  const actor = reviewActorOf(access);
  const raw = readRawInput(formData);

  const existing = await prisma.event.findUnique({ where: { id: eventId }, include: eventInclude });
  if (!existing) {
    return { formError: 'notFound', values: raw };
  }
  // A proposer edits their own events that are not published; a validator any. The page hides the button
  // otherwise: this is the check.
  if (!canEditEvent(actor, reviewedView(existing))) {
    throw new Error('Forbidden');
  }

  // An event that does not repeat is edited as a whole, which is what "this date and the following" does on
  // the first date of a series. So does a proposer: they never edit one date of a series.
  const isSeries = isRepeating(existing);
  const wholeEvent = !isSeries || !actor.canValidate;
  const scope = wholeEvent ? 'following' : requireScope(formData.get('scope'));
  const occurrenceStart = wholeEvent
    ? existing.startsAt
    : (readOccurrence(formData.get('occurrence')) ?? existing.startsAt);

  // One date has no frequency of its own: only the date's own fields are read from the form.
  const parsed = parseEventInput(
    scope === 'occurrence' ? { ...raw, ...NO_REPEAT } : raw,
    formConfig(),
  );
  if (!parsed.ok) {
    return { errors: parsed.errors, values: raw };
  }
  const { data } = parsed;
  const fromStatus = resolvedAt(existing, occurrenceStart)?.status ?? existing.status;
  if (!canChangeStatus(actor, fromStatus, data.status)) {
    throw new Error('Forbidden');
  }

  const assignees = await resolveAssignees(data.assigneeLogins);
  if (!assignees) {
    return { formError: 'invalidAssignee', values: raw };
  }

  const change: DateChange = {
    values: {
      title: data.title,
      description: data.description,
      location: data.location,
      categoryKey: data.categoryKey,
      status: data.status,
      start: data.startsAt,
      end: data.endsAt,
      assigneeLogins: data.assigneeLogins,
    },
    assignees,
  };
  const scopeFields = seriesAuditFields(existing, scope, occurrenceStart);

  const outcome = await inSeries(async (tx) => {
    await assertMayEdit(tx, access, eventId);
    const done =
      scope === 'occurrence'
        ? await updateOccurrence(tx, eventId, occurrenceStart, change)
        : await updateFollowing(tx, eventId, occurrenceStart, {
            ...change,
            repeat: { rule: data.repeat, until: data.recurrenceUntil },
          });

    const changed: string[] = done.changed.filter((key) => key !== 'status');
    const ruleChanged = 'ruleChanged' in done && done.ruleChanged;
    if (ruleChanged) changed.push('recurrence');
    const statusChanged = done.changed.includes('status');
    const detail: Record<string, Prisma.InputJsonValue> =
      'split' in done && done.split ? { splitInto: done.eventId } : {};
    const counts: Record<string, Prisma.InputJsonValue> =
      'aligned' in done && (done.aligned > 0 || done.dropped > 0)
        ? { alignedDates: done.aligned, droppedDates: done.dropped }
        : {};

    if (changed.length > 0) {
      await auditEventAction(
        access,
        'event.update',
        existing,
        { ...scopeFields, changed, ...detail, ...counts },
        tx,
      );
    }
    const move = statusMove(done.before.status, data.status);
    if (statusChanged) {
      await auditEventAction(
        access,
        STATUS_AUDIT_ACTION[move],
        existing,
        { ...scopeFields, from: done.before.status, to: data.status, ...detail },
        tx,
      );
      if (scope === 'following') await settleReviewMarkers(tx, done.eventId, data.status);
    }
    return { ...done, statusChanged, move };
  });
  if (!outcome.ok) return redirectWithNotice(eventId, outcome.notice);
  const result = outcome.value;

  if (result.statusChanged) {
    announceStatusChange({
      move: result.move,
      to: data.status,
      scope,
      eventId: scope === 'following' ? result.eventId : eventId,
      occurrenceStart,
      ownStatus: 'status' in result ? result.status : null,
      actorLogin: access.session.user.login,
    });
  }

  revalidatePath('/events');
  const target = 'split' in result ? result.eventId : eventId;
  const keyOfDate = 'occurrenceStart' in result ? result.occurrenceStart : occurrenceStart;
  redirect({
    href: isSeries
      ? { pathname: `/events/${target}`, query: { occ: keyOfDate.getTime() } }
      : `/events/${target}`,
    locale: await getLocale(),
  });
  return {};
}

export async function deleteEvent(eventId: string): Promise<void> {
  const access = await requireEventsProposer();

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: eventInclude });
  if (!event) {
    return eventGone();
  }
  // A proposer withdraws their own proposals and drafts; a published event is a validator's to delete.
  if (!canDeleteEvent(reviewActorOf(access), reviewedView(event))) {
    throw new Error('Forbidden');
  }

  await prisma.$transaction(async (tx) => {
    await assertMayEdit(tx, access, eventId);
    await tx.event.delete({ where: { id: eventId } });
    await auditEventAction(
      access,
      'event.delete',
      event,
      { status: event.status, ...seriesAuditFields(event, 'following', event.startsAt) },
      tx,
    );
  });

  revalidatePath('/events');
  redirect({ href: '/events', locale: await getLocale() });
}

/**
 * "Delete this date and the following": the series stops at the date before. On the first date this is deleting the
 * event. (Deleting only one date of a series is `cancelOccurrence`, which can be undone.)
 */
export async function deleteFollowingDates(
  eventId: string,
  occurrence: number,
): Promise<ActionTarget> {
  const access = await requireEventsValidator();
  const occurrenceStart = readOccurrence(occurrence);
  if (!occurrenceStart) throw new Error('Invalid occurrence');

  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    return { href: await addressOf(noticeHref(eventId, 'eventGone')) };
  }

  const outcome = await inSeries(async (tx) => {
    const done = await deleteFollowing(tx, eventId, occurrenceStart);
    await auditEventAction(
      access,
      'event.delete',
      existing,
      {
        status: existing.status,
        ...seriesAuditFields(existing, 'following', occurrenceStart),
        removedDates: done.removed,
      },
      tx,
    );
    return done;
  });
  if (!outcome.ok) return { href: await addressOf(noticeHref(eventId, outcome.notice)) };

  revalidatePath('/events');
  return { href: await addressOf(outcome.value.deletedEvent ? '/events' : `/events/${eventId}`) };
}

/** Where an answer to a proposal leaves the validator: the event, or the list of proposals they came from. */
const REVIEW_RETURNS = ['event', 'review'] as const;

/** Moves an event along the circuit: a validator confirms it (approving a proposal) or puts it back to draft, a
 * proposer proposes their draft or withdraws their proposal (see lib/events/review.ts for who may go where). For a
 * series, `occurrence` is the date it is asked on and `scope` whether that date alone changes or that date and
 * the following (confirming the following also confirms those of them that were draft: the dialog says so); a
 * proposer always moves the whole event. */
export async function setEventStatus(
  eventId: string,
  status: EventStatus,
  occurrence?: number,
  scope?: string,
  returnTo: string = 'event',
): Promise<ActionTarget> {
  const access = await requireEventsProposer();
  const actor = reviewActorOf(access);
  if (!EVENT_STATUSES.includes(status)) {
    throw new Error('Invalid status');
  }
  if (!(REVIEW_RETURNS as readonly string[]).includes(returnTo)) {
    throw new Error('Invalid target');
  }

  const existing = await prisma.event.findUnique({ where: { id: eventId }, include: eventInclude });
  if (!existing) {
    return { href: await addressOf(noticeHref(eventId, 'eventGone')) };
  }
  if (!canEditEvent(actor, reviewedView(existing))) {
    throw new Error('Forbidden');
  }
  const isSeries = isRepeating(existing);
  const wholeEvent = !isSeries || !actor.canValidate;
  const chosenScope = wholeEvent ? 'following' : requireScope(scope);
  const occurrenceStart = wholeEvent
    ? existing.startsAt
    : (readOccurrence(occurrence) ?? existing.startsAt);
  const fromStatus = resolvedAt(existing, occurrenceStart)?.status ?? existing.status;
  if (!canChangeStatus(actor, fromStatus, status)) {
    throw new Error('Forbidden');
  }

  const outcome = await inSeries(async (tx) => {
    await assertMayEdit(tx, access, eventId);
    const done =
      chosenScope === 'occurrence'
        ? await updateOccurrence(tx, eventId, occurrenceStart, { values: { status } })
        : await updateFollowing(tx, eventId, occurrenceStart, { values: { status } });
    const changed = done.changed.includes('status');
    const move = statusMove(done.before.status, status);
    if (changed) {
      await auditEventAction(
        access,
        STATUS_AUDIT_ACTION[move],
        existing,
        {
          ...seriesAuditFields(existing, chosenScope, occurrenceStart),
          from: done.before.status,
          to: status,
          ...('split' in done && done.split ? { splitInto: done.eventId } : {}),
          ...('aligned' in done && done.aligned > 0 ? { alignedDates: done.aligned } : {}),
        },
        tx,
      );
      if (chosenScope === 'following') await settleReviewMarkers(tx, done.eventId, status);
    }
    return {
      eventId: done.eventId,
      changed,
      move,
      ownStatus: 'status' in done ? done.status : null,
    };
  });
  if (!outcome.ok) return { href: await addressOf(noticeHref(eventId, outcome.notice)) };
  const result = outcome.value;

  if (result.changed) {
    announceStatusChange({
      move: result.move,
      to: status,
      scope: chosenScope,
      eventId: chosenScope === 'following' ? result.eventId : eventId,
      occurrenceStart,
      ownStatus: result.ownStatus,
      actorLogin: access.session.user.login,
    });
  }

  revalidatePath('/events');
  // After a cut, the date and the following live under the address of the new row.
  if (returnTo === 'review') return { href: await addressOf('/events/review') };
  return {
    href: await addressOf(
      isSeries
        ? { pathname: `/events/${result.eventId}`, query: { occ: occurrenceStart.getTime() } }
        : `/events/${result.eventId}`,
    ),
  };
}

/**
 * A validator refuses a proposal and says why: the event goes back to draft with the comment, which its author
 * reads on the event and receives as a notice. It is the whole event (a proposal is never a single date). Somebody
 * else having reviewed it first is a notice, not an error.
 */
export async function refuseEvent(
  eventId: string,
  comment: string,
  returnTo: string = 'event',
): Promise<ActionTarget> {
  const access = await requireEventsValidator();
  const parsed = parseRefusalComment(comment);
  if (!parsed.ok) throw new Error('Invalid comment');
  if (!(REVIEW_RETURNS as readonly string[]).includes(returnTo)) throw new Error('Invalid target');
  const { user } = access.session;

  const outcome = await inSeries(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) throw new SeriesError('eventGone');
    if (event.status !== 'PROPOSED') return { refused: false as const };

    await tx.event.update({
      where: { id: eventId },
      data: {
        status: 'DRAFT',
        refusalComment: parsed.comment,
        refusedByLogin: user.login,
        refusedAt: new Date(),
      },
    });
    await auditEventAction(
      access,
      'event.refuse',
      event,
      {
        comment: parsed.comment,
        authorLogin: event.authorLogin,
        ...seriesAuditFields(event, 'following', event.startsAt),
      },
      tx,
    );
    return { refused: true as const };
  });
  if (!outcome.ok) return { href: await addressOf(noticeHref(eventId, outcome.notice)) };
  if (!outcome.value.refused) {
    return { href: await addressOf(noticeHref(eventId, 'alreadyReviewed')) };
  }

  after(async () => {
    try {
      await notifyEventRefused(eventId, user.login);
    } catch (error) {
      console.error('[events] refusal notice failed', error);
    }
  });

  revalidatePath('/events');
  return { href: await addressOf(returnTo === 'review' ? '/events/review' : `/events/${eventId}`) };
}

/** `occurrenceStart` is the occurrence's start as epoch milliseconds. */
async function findSeriesOccurrence(eventId: string, occurrenceStart: number) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return { ok: false as const, notice: 'eventGone' as const };
  }
  const start = new Date(occurrenceStart);
  if (!isRepeating(event) || !isOccurrenceStart(event, getConfig().bde.timezone, start)) {
    // The series was edited since the page was drawn: that date is no longer one of its dates.
    return { ok: false as const, notice: 'occurrenceGone' as const };
  }
  return { ok: true as const, event, start };
}

/** The page of one date, which is where cancelling or restoring it leaves the person. */
const dateAddress = (eventId: string, start: Date) =>
  addressOf({ pathname: `/events/${eventId}`, query: { occ: start.getTime() } });

export async function cancelOccurrence(
  eventId: string,
  occurrenceStart: number,
): Promise<ActionTarget> {
  const access = await requireEventsValidator();
  const found = await findSeriesOccurrence(eventId, occurrenceStart);
  if (!found.ok) return { href: await addressOf(noticeHref(eventId, found.notice)) };
  const { event, start } = found;
  const { user } = access.session;

  await prisma.eventCancellation.upsert({
    where: { eventId_occurrenceStart: { eventId, occurrenceStart: start } },
    update: {},
    create: {
      eventId,
      occurrenceStart: start,
      cancelledByLogin: user.login,
      cancelledById: user.id,
    },
  });
  await auditEventAction(access, 'event.occurrence_cancel', event, {
    ...seriesAuditFields(event, 'occurrence', start),
  });

  revalidatePath('/events');
  return { href: await dateAddress(eventId, start) };
}

export async function restoreOccurrence(
  eventId: string,
  occurrenceStart: number,
): Promise<ActionTarget> {
  const access = await requireEventsValidator();
  const found = await findSeriesOccurrence(eventId, occurrenceStart);
  if (!found.ok) return { href: await addressOf(noticeHref(eventId, found.notice)) };
  const { event, start } = found;

  await prisma.eventCancellation.deleteMany({ where: { eventId, occurrenceStart: start } });
  await auditEventAction(access, 'event.occurrence_restore', event, {
    ...seriesAuditFields(event, 'occurrence', start),
  });

  revalidatePath('/events');
  return { href: await dateAddress(eventId, start) };
}
