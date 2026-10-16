import type { EventStatus } from '@/generated/prisma/client';
import { allOccurrences } from './recurrence';
import { toLocalDateTime } from './time';

// The pure rules of a series with dates of their own (see "Events module" in docs/architecture.md).
// A series is one row (the "master") whose dates are computed; a date can have an EventOccurrence row of its own
// holding only what differs from the master; "this date and the following" cuts the series in two rows.
// Nothing here touches the database: series-operations.ts applies these rules, and the tests check them.

/** What a date or a series gets as its audit scope and as the choice offered in the dialog. */
export const SERIES_SCOPES = ['occurrence', 'following'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

export function isSeriesScope(value: unknown): value is SeriesScope {
  return (SERIES_SCOPES as readonly unknown[]).includes(value);
}

export interface AssigneeRef {
  login: string;
  user: { fullName: string; email?: string } | null;
}

/** The own values of one date, as stored (EventOccurrence): null = the series' value. */
export interface OverrideRecord {
  occurrenceStart: Date;
  title: string | null;
  description: string | null;
  location: string | null;
  categoryKey: string | null;
  status: EventStatus | null;
  startsAt: Date | null;
  endsAt: Date | null;
  assigneesOverridden: boolean;
  confirmationNotifiedAt: Date | null;
  updatedAt: Date;
  assignees: AssigneeRef[];
}

/** What the occurrence layer needs from a stored event (see queries.ts). */
export interface EventRecord {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  /** The value of `Event.repeat` (the rule; null: the event does not repeat), read with `readRepeatRule`. */
  repeat?: unknown;
  recurrenceUntil: Date | null;
  /** The first row of the series this one was cut from; null = its own series. */
  seriesId?: string | null;
  confirmationNotifiedAt?: Date | null;
  /** Who created the event: a proposer sees their own unpublished events (see `expandEvents`). */
  authorLogin?: string;
  schoolYear: string;
  updatedAt: Date;
  assignees: AssigneeRef[];
  cancellations: { occurrenceStart: Date }[];
  occurrences?: OverrideRecord[];
}

/** The id that stays the same for every row of a series: the base of the UID of its dates in calendar files. */
export function seriesKeyOf(event: { id: string; seriesId?: string | null }): string {
  return event.seriesId ?? event.id;
}

/** One date of an event as it is: the series' values with the date's own on top. */
export interface ResolvedOccurrence {
  /** Where the series puts it, whatever it was moved to: the key of everything stored about this date. */
  originalStart: Date;
  start: Date;
  end: Date;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: EventStatus;
  assignees: AssigneeRef[];
  cancelled: boolean;
  /** The date has values of its own (it was edited alone). */
  edited: boolean;
  /** When this date was announced: its own notice if it was confirmed alone, else the event's. */
  announcedAt: Date | null;
  updatedAt: Date;
}

/** The values of a date as the event form shows and submits them (text without null, members as logins). */
export interface OccurrenceFields {
  title: string;
  description: string;
  location: string;
  categoryKey: string;
  status: EventStatus;
  start: Date;
  end: Date;
  assigneeLogins: string[];
}

/** What is edited at once on a date: the time is one field (its start and end go together). */
export type FieldKey =
  'title' | 'description' | 'location' | 'categoryKey' | 'status' | 'time' | 'assignees';

const FIELD_KEYS: readonly FieldKey[] = [
  'title',
  'description',
  'location',
  'categoryKey',
  'status',
  'time',
  'assignees',
];

const sortedLogins = (logins: readonly string[]): string[] => [...logins].sort();

export function hasOwnValues(override: OverrideRecord | undefined | null): boolean {
  return (
    !!override &&
    (override.title !== null ||
      override.description !== null ||
      override.location !== null ||
      override.categoryKey !== null ||
      override.status !== null ||
      override.startsAt !== null ||
      override.assigneesOverridden)
  );
}

/** Every date of the event, cancelled ones included (flagged), with the dates' own values applied. */
export function resolveOccurrences(event: EventRecord, timeZone: string): ResolvedOccurrence[] {
  const cancelled = new Set(event.cancellations.map((c) => c.occurrenceStart.getTime()));
  const overrides = new Map(
    (event.occurrences ?? []).map((o) => [o.occurrenceStart.getTime(), o] as const),
  );

  return allOccurrences(event, timeZone).map((occurrence) => {
    const key = occurrence.start.getTime();
    const own = overrides.get(key);
    const ownStatus = own?.status ?? null;
    const moved = own?.startsAt && own.endsAt ? { start: own.startsAt, end: own.endsAt } : null;
    return {
      originalStart: occurrence.start,
      start: moved?.start ?? occurrence.start,
      end: moved?.end ?? occurrence.end,
      title: own?.title ?? event.title,
      description: own?.description ?? event.description,
      location: own?.location ?? event.location,
      categoryKey: own?.categoryKey ?? event.categoryKey,
      status: ownStatus ?? event.status,
      assignees: own?.assigneesOverridden ? own.assignees : event.assignees,
      cancelled: cancelled.has(key),
      edited: hasOwnValues(own),
      announcedAt:
        ownStatus === 'CONFIRMED'
          ? (own?.confirmationNotifiedAt ?? null)
          : (event.confirmationNotifiedAt ?? null),
      updatedAt:
        own && own.updatedAt.getTime() > event.updatedAt.getTime()
          ? own.updatedAt
          : event.updatedAt,
    };
  });
}

/** The values the series itself gives to the date that starts at `originalStart` (no date of its own). */
export function seriesFieldsFor(event: EventRecord, originalStart: Date): OccurrenceFields {
  return {
    title: event.title,
    description: event.description ?? '',
    location: event.location ?? '',
    categoryKey: event.categoryKey,
    status: event.status,
    start: originalStart,
    end: new Date(originalStart.getTime() + (event.endsAt.getTime() - event.startsAt.getTime())),
    assigneeLogins: event.assignees.map((a) => a.login),
  };
}

export function fieldsOf(occurrence: ResolvedOccurrence): OccurrenceFields {
  return {
    title: occurrence.title,
    description: occurrence.description ?? '',
    location: occurrence.location ?? '',
    categoryKey: occurrence.categoryKey,
    status: occurrence.status,
    start: occurrence.start,
    end: occurrence.end,
    assigneeLogins: occurrence.assignees.map((a) => a.login),
  };
}

function sameField(a: OccurrenceFields, b: OccurrenceFields, key: FieldKey): boolean {
  switch (key) {
    case 'time':
      return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
    case 'assignees':
      return (
        sortedLogins(a.assigneeLogins).join('\n') === sortedLogins(b.assigneeLogins).join('\n')
      );
    default:
      return a[key] === b[key];
  }
}

/** The fields whose value differs between two versions of a date. */
export function changedFields(before: OccurrenceFields, after: OccurrenceFields): FieldKey[] {
  return FIELD_KEYS.filter((key) => !sameField(before, after, key));
}

/** The own values of a date, as the columns of its EventOccurrence row. */
export interface OverrideData {
  title: string | null;
  description: string | null;
  location: string | null;
  categoryKey: string | null;
  status: EventStatus | null;
  startsAt: Date | null;
  endsAt: Date | null;
  assigneesOverridden: boolean;
}

export const NO_OVERRIDE: OverrideData = {
  title: null,
  description: null,
  location: null,
  categoryKey: null,
  status: null,
  startsAt: null,
  endsAt: null,
  assigneesOverridden: false,
};

export function overrideDataOf(override: OverrideRecord | undefined | null): OverrideData {
  return override
    ? {
        title: override.title,
        description: override.description,
        location: override.location,
        categoryKey: override.categoryKey,
        status: override.status,
        startsAt: override.startsAt,
        endsAt: override.endsAt,
        assigneesOverridden: override.assigneesOverridden,
      }
    : NO_OVERRIDE;
}

export function isEmptyOverride(data: OverrideData): boolean {
  return (
    data.title === null &&
    data.description === null &&
    data.location === null &&
    data.categoryKey === null &&
    data.status === null &&
    data.startsAt === null &&
    !data.assigneesOverridden
  );
}

/** Puts a version of a date on top of its own values, for the fields in `keys` only: what equals the series'
 * value is not stored (a date never keeps a value that says nothing). `assignees` is the new list when
 * 'assignees' is among the keys (null = the date follows the series). */
export function applyToOverride(
  current: OverrideData,
  series: OccurrenceFields,
  submitted: OccurrenceFields,
  keys: readonly FieldKey[],
): { data: OverrideData; assignees: string[] | null | undefined } {
  const data = { ...current };
  let assignees: string[] | null | undefined;

  for (const key of keys) {
    const same = sameField(series, submitted, key);
    switch (key) {
      case 'time':
        data.startsAt = same ? null : submitted.start;
        data.endsAt = same ? null : submitted.end;
        break;
      case 'assignees':
        data.assigneesOverridden = !same;
        assignees = same ? null : [...new Set(submitted.assigneeLogins)];
        break;
      case 'status':
        data.status = same ? null : submitted.status;
        break;
      default:
        data[key] = same ? null : submitted[key];
    }
  }
  return { data, assignees };
}

/** The date's own values minus those of `keys` (what a "this and the following" edit has just decided for
 * everyone). `assigneesCleared` tells the caller to delete the date's own list. */
export function clearOverride(
  current: OverrideData,
  keys: readonly FieldKey[],
): { data: OverrideData; assigneesCleared: boolean } {
  const data = { ...current };
  let assigneesCleared = false;
  for (const key of keys) {
    switch (key) {
      case 'time':
        data.startsAt = null;
        data.endsAt = null;
        break;
      case 'assignees':
        assigneesCleared = data.assigneesOverridden;
        data.assigneesOverridden = false;
        break;
      default:
        data[key] = null;
    }
  }
  return { data, assigneesCleared };
}

/** Which of the old dates are still dates of the new series: the same calendar day (on the BDE's wall clock)
 * keeps what was stored about it, even when its hour changed. Maps old start → new start (epoch ms). */
export function remapByLocalDay(
  oldStarts: readonly Date[],
  newStarts: readonly Date[],
  timeZone: string,
): Map<number, Date> {
  const byDay = new Map(newStarts.map((start) => [localDayKey(start, timeZone), start] as const));
  const mapping = new Map<number, Date>();
  for (const start of oldStarts) {
    const target = byDay.get(localDayKey(start, timeZone));
    if (target) mapping.set(start.getTime(), target);
  }
  return mapping;
}

/** The calendar day of a date's start on the BDE's wall clock, for "did the day change". */
export function localDayKey(date: Date, timeZone: string): string {
  const local = toLocalDateTime(date, timeZone);
  return `${local.year}-${local.month}-${local.day}`;
}

/** What the dialog of a series says about the choice "this date and the following", counted from `originalStart`. */
export interface ScopeFacts {
  /** The first date of the series: "and the following" is then the whole series. */
  isFirst: boolean;
  /** Dates of the series, all of them. */
  total: number;
  /** Dates after this one. */
  following: number;
  /** Dates after this one that are drafts (and not cancelled): confirming the following confirms them. */
  drafts: number;
  /** Dates after this one that have values of their own: an edit of the following aligns them. */
  edited: number;
}

export function scopeFacts(dates: readonly ResolvedOccurrence[], originalStart: Date): ScopeFacts {
  const index = Math.max(
    0,
    dates.findIndex((d) => d.originalStart.getTime() === originalStart.getTime()),
  );
  const following = dates.slice(index + 1);
  return {
    isFirst: index === 0,
    total: dates.length,
    following: following.length,
    drafts: following.filter((d) => !d.cancelled && d.status === 'DRAFT').length,
    edited: following.filter((d) => d.edited).length,
  };
}
