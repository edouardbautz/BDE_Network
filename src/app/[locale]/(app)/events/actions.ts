'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getLocale } from 'next-intl/server';
import { getConfig } from '@/config';
import type { EventStatus, Prisma } from '@/generated/prisma/client';
import { getPathname, redirect } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { prisma } from '@/lib/prisma';
import { requireEventsManager } from '@/lib/events/access';
import { APPROVED_STATUSES } from '@/lib/permissions';
import { auditEventAction, seriesAuditFields } from '@/lib/events/audit';
import {
  EVENT_STATUSES,
  parseEventInput,
  toEventRow,
  type EventFormErrors,
  type RawEventInput,
} from '@/lib/events/input';
import { notifyEventConfirmed, notifyOccurrenceConfirmed } from '@/lib/events/notifications';
import { isOccurrenceStart } from '@/lib/events/recurrence';
import {
  SeriesError,
  deleteFollowing,
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
    recurrence: text('recurrence'),
    recurrenceUntil: text('recurrenceUntil'),
    status: text('status'),
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
  const access = await requireEventsManager();
  const raw = readRawInput(formData);

  const parsed = parseEventInput(raw, formConfig());
  if (!parsed.ok) {
    return { errors: parsed.errors, values: raw };
  }

  const assignees = await resolveAssignees(parsed.data.assigneeLogins);
  if (!assignees) {
    return { formError: 'invalidAssignee', values: raw };
  }

  const data = toEventRow(parsed.data);
  const { user } = access.session;

  const event = await prisma.event.create({
    data: {
      ...data,
      authorLogin: user.login,
      authorId: user.id,
      assignees: { create: assignees.map((a) => ({ login: a.login, userId: a.id })) },
    },
  });

  await auditEventAction(access, 'event.create', event, {
    status: event.status,
    recurrence: event.recurrence,
  });

  if (event.status === 'CONFIRMED') {
    announceConfirmation(event.id);
  }

  revalidatePath('/events');
  redirect({ href: `/events/${event.id}`, locale: await getLocale() });
  return {};
}

// ---- what a series changes in an action ---------------------------------------------------------------------------

type Notice = 'eventGone' | 'occurrenceGone' | 'seriesBusy';

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
  const access = await requireEventsManager();
  const raw = readRawInput(formData);

  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    return { formError: 'notFound', values: raw };
  }

  // An event that does not repeat is edited as a whole, which is what "this date and the following" does on
  // the first date of a series.
  const isSeries = existing.recurrence !== 'NONE';
  const scope = isSeries ? requireScope(formData.get('scope')) : 'following';
  const occurrenceStart = isSeries
    ? (readOccurrence(formData.get('occurrence')) ?? existing.startsAt)
    : existing.startsAt;

  // One date has no frequency of its own: only the date's own fields are read from the form.
  const parsed = parseEventInput(
    scope === 'occurrence' ? { ...raw, recurrence: 'NONE', recurrenceUntil: '' } : raw,
    formConfig(),
  );
  if (!parsed.ok) {
    return { errors: parsed.errors, values: raw };
  }
  const { data } = parsed;

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
    const done =
      scope === 'occurrence'
        ? await updateOccurrence(tx, eventId, occurrenceStart, change)
        : await updateFollowing(tx, eventId, occurrenceStart, {
            ...change,
            recurrence: {
              recurrence: data.recurrence,
              recurrenceUntil: data.recurrenceUntil,
            },
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
    if (statusChanged) {
      await auditEventAction(
        access,
        'event.status_change',
        existing,
        { ...scopeFields, from: done.before.status, to: data.status, ...detail },
        tx,
      );
    }
    return { ...done, statusChanged };
  });
  if (!outcome.ok) return redirectWithNotice(eventId, outcome.notice);
  const result = outcome.value;

  if (result.statusChanged && data.status === 'CONFIRMED') {
    if (scope === 'following') {
      announceConfirmation(result.eventId);
    } else if ('status' in result && result.status === 'CONFIRMED') {
      // A date that is simply confirmed again, like the rest of its series, has nothing to announce.
      announceOccurrence(eventId, occurrenceStart);
    }
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
  const access = await requireEventsManager();

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return eventGone();
  }

  await prisma.event.delete({ where: { id: eventId } });
  await auditEventAction(access, 'event.delete', event, {
    status: event.status,
    ...seriesAuditFields(event, 'following', event.startsAt),
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
  const access = await requireEventsManager();
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

/** Confirms an event or puts it back to draft. For a series, `occurrence` is the date it is asked on and `scope`
 * whether that date alone changes or that date and the following (confirming the following also confirms those
 * of them that were draft: the dialog says so). */
export async function setEventStatus(
  eventId: string,
  status: EventStatus,
  occurrence?: number,
  scope?: string,
): Promise<ActionTarget> {
  const access = await requireEventsManager();
  if (!EVENT_STATUSES.includes(status)) {
    throw new Error('Invalid status');
  }

  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    return { href: await addressOf(noticeHref(eventId, 'eventGone')) };
  }
  const isSeries = existing.recurrence !== 'NONE';
  const chosenScope = isSeries ? requireScope(scope) : 'following';
  const occurrenceStart = isSeries
    ? (readOccurrence(occurrence) ?? existing.startsAt)
    : existing.startsAt;

  const outcome = await inSeries(async (tx) => {
    const done =
      chosenScope === 'occurrence'
        ? await updateOccurrence(tx, eventId, occurrenceStart, { values: { status } })
        : await updateFollowing(tx, eventId, occurrenceStart, { values: { status } });
    const changed = done.changed.includes('status');
    if (changed) {
      await auditEventAction(
        access,
        'event.status_change',
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
    }
    return { eventId: done.eventId, changed, ownStatus: 'status' in done ? done.status : null };
  });
  if (!outcome.ok) return { href: await addressOf(noticeHref(eventId, outcome.notice)) };
  const result = outcome.value;

  if (result.changed && status === 'CONFIRMED') {
    if (chosenScope === 'following') {
      announceConfirmation(result.eventId);
    } else if (result.ownStatus === 'CONFIRMED') {
      // A date that is simply confirmed again, like the rest of its series, has nothing to announce.
      announceOccurrence(eventId, occurrenceStart);
    }
  }

  revalidatePath('/events');
  // After a cut, the date and the following live under the address of the new row.
  return {
    href: await addressOf(
      isSeries
        ? { pathname: `/events/${result.eventId}`, query: { occ: occurrenceStart.getTime() } }
        : `/events/${result.eventId}`,
    ),
  };
}

/** `occurrenceStart` is the occurrence's start as epoch milliseconds. */
async function findSeriesOccurrence(eventId: string, occurrenceStart: number) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return { ok: false as const, notice: 'eventGone' as const };
  }
  const start = new Date(occurrenceStart);
  if (event.recurrence === 'NONE' || !isOccurrenceStart(event, getConfig().bde.timezone, start)) {
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
  const access = await requireEventsManager();
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
  const access = await requireEventsManager();
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
