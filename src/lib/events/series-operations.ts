import { getConfig } from '@/config';
import type { EventStatus, Prisma } from '@/generated/prisma/client';
import { eventInclude } from './include';
import { allOccurrences, type RecurringSource } from './recurrence';
import { cutRule, readRepeatRule, sameRepeat, type RepeatRule } from './repeat';
import { repeatColumn } from './repeat-column';
import {
  applyToOverride,
  changedFields,
  clearOverride,
  fieldsOf,
  isEmptyOverride,
  localDayKey,
  overrideDataOf,
  remapByLocalDay,
  resolveOccurrences,
  seriesFieldsFor,
  seriesKeyOf,
  type EventRecord,
  type FieldKey,
  type OccurrenceFields,
  type OverrideData,
  type OverrideRecord,
} from './series';
import { schoolYearOf, toLocalDateTime } from './time';

// What "only this date" and "this date and the following" do to the database. Every function takes the
// transaction of its caller (transaction.ts: SERIALIZABLE, retried), reads the event again inside it, and
// leaves the audit entry to the caller, written in the same transaction. The rules themselves are in series.ts.

type Tx = Prisma.TransactionClient;

/** What was asked for no longer exists: the page was drawn before somebody else changed the series. */
export class SeriesError extends Error {
  constructor(public readonly code: 'eventGone' | 'occurrenceGone') {
    super(code);
  }
}

/** Who is put in charge: the accounts found for the logins that were submitted. */
export interface Assignee {
  id: string;
  login: string;
}

/** What is asked of a date: the values to give it (all of them, for an edit form; only the status, for a
 * confirmation). What really changes is worked out inside the transaction, against the date as it is then:
 * a field that already has the value asked is not "changed" and decides nothing for the other dates. */
export interface DateChange {
  values: Partial<OccurrenceFields>;
  /** The accounts of `values.assigneeLogins`, when it is given. */
  assignees?: readonly Assignee[];
}

/** For "this date and the following": the series' own rule, when the form also changes it: how it repeats (null: it
 * does not) and when it ends (see `Event.recurrenceUntil`). */
export interface FollowingChange extends DateChange {
  repeat?: { rule: RepeatRule | null; until: Date | null };
}

const timeZone = () => getConfig().bde.timezone;

/** Two series ends are the same when they fall on the same day (the form only knows the day). */
function sameDay(a: Date | null, b: Date | null, zone: string): boolean {
  return a === null || b === null ? a === b : localDayKey(a, zone) === localDayKey(b, zone);
}

async function loadEvent(tx: Tx, id: string) {
  const event = await tx.event.findUnique({ where: { id }, include: eventInclude });
  if (!event) throw new SeriesError('eventGone');
  return event;
}

type LoadedEvent = Awaited<ReturnType<typeof loadEvent>>;

/** The event and the position of the date that starts at `occurrenceStart` among its dates. */
async function locate(tx: Tx, eventId: string, occurrenceStart: Date) {
  const event = await loadEvent(tx, eventId);
  const starts = allOccurrences(event, timeZone());
  const index = starts.findIndex((o) => o.start.getTime() === occurrenceStart.getTime());
  if (index === -1) throw new SeriesError('occurrenceGone');
  return { event, starts, index };
}

/** What one date is now (its own values on top of the series'), for the caller to compare a form with. */
export function resolvedAt(event: EventRecord, occurrenceStart: Date) {
  return resolveOccurrences(event, timeZone()).find(
    (o) => o.originalStart.getTime() === occurrenceStart.getTime(),
  );
}

/** The date as it is now, and which of the asked fields differ from it. */
function compare(event: LoadedEvent, occurrenceStart: Date, change: DateChange) {
  const current = fieldsOf(resolvedAt(event, occurrenceStart)!);
  const wanted: OccurrenceFields = { ...current, ...change.values };
  return { current, wanted, keys: changedFields(current, wanted) };
}

// ---- only this date ---------------------------------------------------------------------------------------------

async function replaceOccurrenceAssignees(
  tx: Tx,
  occurrenceId: string,
  assignees: readonly Assignee[],
) {
  await tx.eventOccurrenceAssignee.deleteMany({ where: { occurrenceId } });
  if (assignees.length > 0) {
    await tx.eventOccurrenceAssignee.createMany({
      data: assignees.map((a) => ({ occurrenceId, login: a.login, userId: a.id })),
    });
  }
}

/** Writes the own values of a date, or forgets the date's row when nothing is left of its own (a notice that
 * was claimed for it keeps the row: confirming again must not announce it again). */
async function saveOverride(
  tx: Tx,
  eventId: string,
  occurrenceStart: Date,
  existing: OverrideRecord | undefined,
  data: OverrideData,
  assignees: readonly Assignee[] | null | undefined,
) {
  const claimed = existing?.confirmationNotifiedAt != null;
  const where = { eventId_occurrenceStart: { eventId, occurrenceStart } };
  if (isEmptyOverride(data) && !claimed) {
    await tx.eventOccurrence.deleteMany({ where: { eventId, occurrenceStart } });
    return;
  }
  const row = await tx.eventOccurrence.upsert({
    where,
    update: data,
    create: { eventId, occurrenceStart, ...data },
  });
  if (assignees !== undefined) {
    await replaceOccurrenceAssignees(tx, row.id, assignees ?? []);
  }
}

/** "Only this one": the date gets the fields that changed, and only those. */
export async function updateOccurrence(
  tx: Tx,
  eventId: string,
  occurrenceStart: Date,
  change: DateChange,
): Promise<{
  eventId: string;
  /** The date as it was before, and what it is now (its own status; null = the series'). */
  before: OccurrenceFields;
  status: EventStatus | null;
  changed: FieldKey[];
}> {
  const { event } = await locate(tx, eventId, occurrenceStart);
  const { current, wanted, keys } = compare(event, occurrenceStart, change);
  const existing = event.occurrences.find(
    (o) => o.occurrenceStart.getTime() === occurrenceStart.getTime(),
  );
  const { data, assignees } = applyToOverride(
    overrideDataOf(existing),
    seriesFieldsFor(event, occurrenceStart),
    wanted,
    keys,
  );
  await saveOverride(
    tx,
    event.id,
    occurrenceStart,
    existing,
    data,
    assignees === undefined ? undefined : assignees === null ? null : (change.assignees ?? []),
  );
  return { eventId: event.id, before: current, status: data.status, changed: keys };
}

// ---- this date and the following ----------------------------------------------------------------------------------

/** Cuts a series in two rows at the date `starts[index]` (index ≥ 1): the first row stops at the date before,
 * the new one gets the date and everything after it, with what was stored about those dates. */
async function splitSeries(
  tx: Tx,
  event: LoadedEvent,
  starts: readonly { start: Date }[],
  index: number,
): Promise<LoadedEvent> {
  const zone = timeZone();
  const cutAt = starts[index]!.start;
  const before = starts[index - 1]!.start;
  // The two rows share the rule: the dates before the cut for the first, the others for the new one.
  const rule = readRepeatRule(event.repeat);
  const cut = rule ? cutRule(rule, toLocalDateTime(event.startsAt, zone), index) : null;

  const tail = await tx.event.create({
    data: {
      title: event.title,
      description: event.description,
      location: event.location,
      categoryKey: event.categoryKey,
      status: event.status,
      startsAt: cutAt,
      endsAt: new Date(cutAt.getTime() + (event.endsAt.getTime() - event.startsAt.getTime())),
      repeat: repeatColumn(cut?.tail ?? null),
      recurrenceUntil: event.recurrenceUntil,
      schoolYear: schoolYearOf(cutAt, zone),
      // The same series: announced once, not again because it was cut.
      confirmationNotifiedAt: event.confirmationNotifiedAt,
      seriesId: seriesKeyOf(event),
      authorLogin: event.authorLogin,
      authorId: event.authorId,
      assignees: { create: event.assignees.map((a) => ({ login: a.login, userId: a.userId })) },
    },
  });

  const from = { eventId: event.id, occurrenceStart: { gte: cutAt } };
  await tx.eventOccurrence.updateMany({ where: from, data: { eventId: tail.id } });
  await tx.eventCancellation.updateMany({ where: from, data: { eventId: tail.id } });
  await tx.eventReminder.updateMany({ where: from, data: { eventId: tail.id } });
  await tx.event.update({
    where: { id: event.id },
    data: endSeriesAt(index - 1, before, cut?.head ?? null),
  });

  return loadEvent(tx, tail.id);
}

/** A series that is left with one date is an ordinary event; otherwise it stops at its last date. */
function endSeriesAt(
  lastIndex: number,
  lastStart: Date,
  head: RepeatRule | null,
): Prisma.EventUpdateInput {
  return lastIndex === 0
    ? { repeat: repeatColumn(null), recurrenceUntil: null }
    : { repeat: repeatColumn(head), recurrenceUntil: lastStart };
}

export interface FollowingResult {
  /** The row that now holds the date and the following: the event itself, or the new row of a cut series. */
  eventId: string;
  /** The series was cut in two (the date is not its first). */
  split: boolean;
  /** The date as it was before the change. */
  before: OccurrenceFields;
  /** The date's start after the change (its key in `eventId`'s row; moves with a change of time). */
  occurrenceStart: Date;
  /** The fields of the date that changed, and whether the series' own rule (frequency, end) did. */
  changed: FieldKey[];
  ruleChanged: boolean;
  /** Dates that had values of their own and had some of them replaced by this change. */
  aligned: number;
  /** Dates whose own values or cancellation were dropped because the date no longer exists in the series. */
  dropped: number;
}

/** "This date and the following". On the first date nothing is cut: the whole series changes. */
export async function updateFollowing(
  tx: Tx,
  eventId: string,
  occurrenceStart: Date,
  change: FollowingChange,
): Promise<FollowingResult> {
  const zone = timeZone();
  const { event, starts, index } = await locate(tx, eventId, occurrenceStart);
  const { current: before, wanted, keys } = compare(event, occurrenceStart, change);
  // The rule as the form asks it against the one stored, both read from the first date the form gives (what a rule
  // leaves out follows it). A rule that gives the same dates is not a change, however it is written.
  const wantedFirst = toLocalDateTime(wanted.start, zone);
  const ruleChanged =
    !!change.repeat &&
    (!sameRepeat(change.repeat.rule, readRepeatRule(event.repeat), wantedFirst) ||
      sameDay(change.repeat.until, event.recurrenceUntil, zone) === false);
  if (keys.length === 0 && !ruleChanged) {
    // Nothing to change: not worth cutting the series.
    return {
      eventId: event.id,
      split: false,
      before,
      occurrenceStart,
      changed: [],
      ruleChanged: false,
      aligned: 0,
      dropped: 0,
    };
  }

  const row = index === 0 ? event : await splitSeries(tx, event, starts, index);
  const touches = (key: FieldKey) => keys.includes(key);

  const update: Prisma.EventUncheckedUpdateInput = {};
  if (touches('title')) update.title = wanted.title;
  if (touches('description')) update.description = wanted.description;
  if (touches('location')) update.location = wanted.location;
  if (touches('categoryKey')) update.categoryKey = wanted.categoryKey;
  if (touches('status')) update.status = wanted.status;
  if (touches('time')) {
    update.startsAt = wanted.start;
    update.endsAt = wanted.end;
    update.schoolYear = schoolYearOf(wanted.start, zone);
  }
  if (change.repeat && ruleChanged) {
    update.repeat = repeatColumn(change.repeat.rule);
    update.recurrenceUntil = change.repeat.rule ? change.repeat.until : null;
  }

  const next: RecurringSource = {
    startsAt: (update.startsAt as Date | undefined) ?? row.startsAt,
    endsAt: (update.endsAt as Date | undefined) ?? row.endsAt,
    repeat: change.repeat && ruleChanged ? change.repeat.rule : row.repeat,
    recurrenceUntil:
      update.recurrenceUntil === undefined
        ? row.recurrenceUntil
        : (update.recurrenceUntil as Date | null),
  };
  const dateMap = remapByLocalDay(
    allOccurrences(row, zone).map((o) => o.start),
    allOccurrences(next, zone).map((o) => o.start),
    zone,
  );

  // What was stored about the dates of the row follows them to their new place, or goes when they are gone.
  const result: FollowingResult = {
    eventId: row.id,
    split: row.id !== event.id,
    before,
    occurrenceStart: (update.startsAt as Date | undefined) ?? row.startsAt,
    changed: [...keys],
    ruleChanged,
    aligned: 0,
    dropped: 0,
  };
  for (const own of row.occurrences) {
    const target = dateMap.get(own.occurrenceStart.getTime());
    if (!target) {
      await tx.eventOccurrence.delete({ where: { id: own.id } });
      result.dropped += 1;
      continue;
    }
    const before = overrideDataOf(own);
    const { data, assigneesCleared } = clearOverride(before, keys);
    const changed = JSON.stringify(data) !== JSON.stringify(before);
    const claimed = own.confirmationNotifiedAt != null;
    if (changed) result.aligned += 1;

    if (isEmptyOverride(data) && !claimed) {
      await tx.eventOccurrence.delete({ where: { id: own.id } });
    } else if (changed || target.getTime() !== own.occurrenceStart.getTime()) {
      await tx.eventOccurrence.update({
        where: { id: own.id },
        data: { ...data, occurrenceStart: target },
      });
      if (assigneesCleared) {
        await tx.eventOccurrenceAssignee.deleteMany({ where: { occurrenceId: own.id } });
      }
    }
  }
  for (const cancellation of await tx.eventCancellation.findMany({ where: { eventId: row.id } })) {
    const target = dateMap.get(cancellation.occurrenceStart.getTime());
    if (!target) {
      await tx.eventCancellation.delete({ where: { id: cancellation.id } });
      result.dropped += 1;
    } else if (target.getTime() !== cancellation.occurrenceStart.getTime()) {
      await tx.eventCancellation.update({
        where: { id: cancellation.id },
        data: { occurrenceStart: target },
      });
    }
  }
  // A reminder already sent for a date stays sent when the date only moved: once per date, whatever happens.
  for (const reminder of await tx.eventReminder.findMany({ where: { eventId: row.id } })) {
    const target = dateMap.get(reminder.occurrenceStart.getTime());
    if (!target) {
      await tx.eventReminder.delete({ where: { id: reminder.id } });
    } else if (target.getTime() !== reminder.occurrenceStart.getTime()) {
      await tx.eventReminder.update({
        where: { id: reminder.id },
        data: { occurrenceStart: target },
      });
    }
  }

  if (touches('assignees')) {
    await tx.eventAssignee.deleteMany({ where: { eventId: row.id } });
    const people = change.assignees ?? [];
    if (people.length > 0) {
      await tx.eventAssignee.createMany({
        data: people.map((a) => ({ eventId: row.id, login: a.login, userId: a.id })),
      });
    }
  }
  await tx.event.update({ where: { id: row.id }, data: update });
  return result;
}

export interface DeleteFollowingResult {
  /** The first date was chosen: the whole event is gone. */
  deletedEvent: boolean;
  /** Dates that existed from the chosen one on. */
  removed: number;
}

/** "Delete this date and the following": the series stops at the date before; on the first date the event goes. */
export async function deleteFollowing(
  tx: Tx,
  eventId: string,
  occurrenceStart: Date,
): Promise<DeleteFollowingResult> {
  const { event, starts, index } = await locate(tx, eventId, occurrenceStart);
  const removed = starts.length - index;
  if (index === 0) {
    await tx.event.delete({ where: { id: event.id } });
    return { deletedEvent: true, removed };
  }
  const from = { eventId: event.id, occurrenceStart: { gte: occurrenceStart } };
  await tx.eventOccurrence.deleteMany({ where: from });
  await tx.eventCancellation.deleteMany({ where: from });
  await tx.eventReminder.deleteMany({ where: from });
  const rule = readRepeatRule(event.repeat);
  const head = rule ? cutRule(rule, toLocalDateTime(event.startsAt, timeZone()), index).head : null;
  await tx.event.update({
    where: { id: event.id },
    data: endSeriesAt(index - 1, starts[index - 1]!.start, head),
  });
  return { deletedEvent: false, removed };
}
