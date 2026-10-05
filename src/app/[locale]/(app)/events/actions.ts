'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getLocale } from 'next-intl/server';
import { getConfig } from '@/config';
import type { EventStatus } from '@/generated/prisma/client';
import { redirect } from '@/i18n/navigation';
import { prisma } from '@/lib/prisma';
import { requireEventsManager } from '@/lib/events/access';
import { APPROVED_ROLES } from '@/lib/permissions';
import { auditEventAction } from '@/lib/events/audit';
import {
  EVENT_STATUSES,
  parseEventInput,
  toEventRow,
  type EventFormErrors,
  type RawEventInput,
} from '@/lib/events/input';
import { notifyEventConfirmed } from '@/lib/events/notifications';
import { allOccurrences, isOccurrenceStart } from '@/lib/events/recurrence';

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

/** Announces a confirmed event after the response is sent. The notification
 * layer never throws, and this wrapper makes sure nothing it does — not even
 * an unexpected rejection — can fail or delay saving the event. */
function announceConfirmation(eventId: string): void {
  after(async () => {
    try {
      await notifyEventConfirmed(eventId);
    } catch (error) {
      console.error('[events] confirmation notice failed', error);
    }
  });
}

/** Resolves the requested logins to approved accounts, or null if any is unknown. */
async function resolveAssignees(logins: string[]) {
  if (logins.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { login: { in: logins }, role: { in: [...APPROVED_ROLES] } },
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

export async function updateEvent(
  eventId: string,
  _previous: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const access = await requireEventsManager();
  const raw = readRawInput(formData);

  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    include: { assignees: { select: { login: true } } },
  });
  if (!existing) {
    return { formError: 'notFound', values: raw };
  }

  const config = formConfig();
  const parsed = parseEventInput(raw, config);
  if (!parsed.ok) {
    return { errors: parsed.errors, values: raw };
  }

  const assignees = await resolveAssignees(parsed.data.assigneeLogins);
  if (!assignees) {
    return { formError: 'invalidAssignee', values: raw };
  }

  const data = toEventRow(parsed.data);
  const { assigneeLogins } = parsed.data;

  // Cancellations only make sense for occurrences that still exist after the
  // series was edited (e.g. its day or frequency changed): drop the others.
  const remainingStarts = allOccurrences(data, config.timeZone).map((o) => o.start.getTime());

  const changed = (
    [
      ['title', existing.title !== data.title],
      ['description', existing.description !== data.description],
      ['location', existing.location !== data.location],
      ['category', existing.categoryKey !== data.categoryKey],
      ['startsAt', existing.startsAt.getTime() !== data.startsAt.getTime()],
      ['endsAt', existing.endsAt.getTime() !== data.endsAt.getTime()],
      ['recurrence', existing.recurrence !== data.recurrence],
      ['recurrenceUntil', existing.recurrenceUntil?.getTime() !== data.recurrenceUntil?.getTime()],
      [
        'assignees',
        [...existing.assignees.map((a) => a.login)].sort().join() !==
          [...assigneeLogins].sort().join(),
      ],
    ] as const
  )
    .filter(([, isChanged]) => isChanged)
    .map(([field]) => field);

  const statusChanged = existing.status !== data.status;

  const [event] = await prisma.$transaction([
    prisma.event.update({
      where: { id: eventId },
      data: {
        ...data,
        assignees: {
          deleteMany: {},
          create: assignees.map((a) => ({ login: a.login, userId: a.id })),
        },
      },
    }),
    prisma.eventCancellation.deleteMany({
      where: {
        eventId,
        occurrenceStart: { notIn: remainingStarts.map((ms) => new Date(ms)) },
      },
    }),
  ]);

  if (changed.length > 0) {
    await auditEventAction(access, 'event.update', event, { changed: [...changed] });
  }
  if (statusChanged) {
    await auditEventAction(access, 'event.status_change', event, {
      from: existing.status,
      to: event.status,
    });
  }
  if (statusChanged && event.status === 'CONFIRMED') {
    announceConfirmation(event.id);
  }

  revalidatePath('/events');
  redirect({ href: `/events/${event.id}`, locale: await getLocale() });
  return {};
}

export async function deleteEvent(eventId: string): Promise<void> {
  const access = await requireEventsManager();

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new Error('Event not found');
  }

  await prisma.event.delete({ where: { id: eventId } });
  await auditEventAction(access, 'event.delete', event, { status: event.status });

  revalidatePath('/events');
  redirect({ href: '/events', locale: await getLocale() });
}

export async function setEventStatus(eventId: string, status: EventStatus): Promise<void> {
  const access = await requireEventsManager();
  if (!EVENT_STATUSES.includes(status)) {
    throw new Error('Invalid status');
  }

  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    throw new Error('Event not found');
  }
  if (existing.status === status) {
    return;
  }

  const event = await prisma.event.update({ where: { id: eventId }, data: { status } });
  await auditEventAction(access, 'event.status_change', event, {
    from: existing.status,
    to: status,
  });

  if (status === 'CONFIRMED') {
    announceConfirmation(event.id);
  }

  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
}

/** `occurrenceStart` is the occurrence's start as epoch milliseconds. */
async function findSeriesOccurrence(eventId: string, occurrenceStart: number) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new Error('Event not found');
  }
  const start = new Date(occurrenceStart);
  if (event.recurrence === 'NONE' || !isOccurrenceStart(event, getConfig().bde.timezone, start)) {
    throw new Error('Not an occurrence of this recurring event');
  }
  return { event, start };
}

export async function cancelOccurrence(eventId: string, occurrenceStart: number): Promise<void> {
  const access = await requireEventsManager();
  const { event, start } = await findSeriesOccurrence(eventId, occurrenceStart);
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
    occurrenceStart: start.toISOString(),
  });

  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
}

export async function restoreOccurrence(eventId: string, occurrenceStart: number): Promise<void> {
  const access = await requireEventsManager();
  const { event, start } = await findSeriesOccurrence(eventId, occurrenceStart);

  await prisma.eventCancellation.deleteMany({ where: { eventId, occurrenceStart: start } });
  await auditEventAction(access, 'event.occurrence_restore', event, {
    occurrenceStart: start.toISOString(),
  });

  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
}
