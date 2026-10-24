import type { IntraAudience, IntraRequestStatus } from '@/generated/prisma/client';
import { intraOf, INTRA_AUDIENCES, INTRA_KINDS, type IntraColumns, type IntraFields } from './intra';
import { resolveOccurrences, type EventRecord } from './series';
import { toLocalDateTime } from './time';

// What the school's staff is asked to publish on the intra, and where that stands (see "The staff publishes on the intra" in
// docs/architecture.md). Pure: the database side is `intra-sync.ts`, the pages and actions use only this and that.

/** Where a request stands: the statuses of the table, and the words the pages use for them. */
export const INTRA_STATUSES: readonly IntraRequestStatus[] = [
  'PENDING',
  'PUBLISHED',
  'OUTDATED',
  'REFUSED',
];

/** Waits for the staff: a first publication, or an update of what is already there. */
export function needsStaff(status: IntraRequestStatus): boolean {
  return status === 'PENDING' || status === 'OUTDATED';
}

/** The event is on the intra (and may have changed since). */
export function isOnIntra(status: IntraRequestStatus): boolean {
  return status === 'PUBLISHED' || status === 'OUTDATED';
}

/** One date of the event as the intra needs it. A value the date has of its own is there only when it differs from the
 * series': most dates are just a start and an end. */
export interface IntraDate {
  /** ISO 8601, UTC. */
  start: string;
  end: string;
  title?: string;
  description?: string;
  location?: string;
}

/** Everything the staff copies into the intra for an event, and so everything whose change is worth telling them. */
export interface IntraContent {
  title: string;
  description: string;
  location: string;
  fields: IntraFields;
  /** The dates that are published (confirmed and not cancelled), in order. At least one. */
  dates: IntraDate[];
}

/** An event row with what the intra content is made of. */
export type IntraSource = EventRecord & Partial<IntraColumns>;

export type IntraReadiness =
  { ok: true; content: IntraContent } | { ok: false; reason: 'fieldsMissing' | 'notPublished' };

/** The content to publish for an event, or why there is none yet: the fields of the intra are missing, or no date is published. */
export function intraReadiness(event: IntraSource, timeZone: string): IntraReadiness {
  const fields = intraOf(event);
  if (!fields) return { ok: false, reason: 'fieldsMissing' };
  const description = event.description ?? '';
  const location = event.location ?? '';
  const dates: IntraDate[] = [];
  for (const date of resolveOccurrences(event, timeZone)) {
    if (date.cancelled || date.status !== 'CONFIRMED') continue;
    const own: IntraDate = { start: date.start.toISOString(), end: date.end.toISOString() };
    if (date.title !== event.title) own.title = date.title;
    if ((date.description ?? '') !== description) own.description = date.description ?? '';
    if ((date.location ?? '') !== location) own.location = date.location ?? '';
    dates.push(own);
  }
  if (dates.length === 0) return { ok: false, reason: 'notPublished' };
  return { ok: true, content: { title: event.title, description, location, fields, dates } };
}

/** The content written the same way every time (fixed order of keys), whatever built it: what is compared and hashed. */
export function canonicalContent(content: IntraContent): string {
  const { fields } = content;
  return JSON.stringify({
    title: content.title,
    description: content.description,
    location: content.location,
    fields: {
      organizerLogin: fields.organizerLogin,
      audience: fields.audience,
      maxPeople: fields.maxPeople,
      waitingList: fields.waitingList,
      kind: fields.kind,
      unsubscribeHours: fields.unsubscribeHours,
      keywords: fields.keywords,
    },
    dates: content.dates.map((date) => ({
      start: date.start,
      end: date.end,
      title: date.title ?? null,
      description: date.description ?? null,
      location: date.location ?? null,
    })),
  });
}

export function sameContent(a: IntraContent | null, b: IntraContent | null): boolean {
  if (a === null || b === null) return a === b;
  return canonicalContent(a) === canonicalContent(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const INVALID = Symbol('invalid');

/** A text that may be absent: itself, undefined, or INVALID for anything else. */
function optionalText(value: unknown): string | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : INVALID;
}

/** What a stored `publishedContent` holds, or null when it is not a content (never trusted: it is JSON). */
export function readContent(value: unknown): IntraContent | null {
  if (!isRecord(value) || !isRecord(value.fields) || !Array.isArray(value.dates)) return null;
  const { title, description, location } = value;
  const f = value.fields;
  if (typeof title !== 'string' || typeof description !== 'string' || typeof location !== 'string') {
    return null;
  }
  const audience = INTRA_AUDIENCES.find((candidate) => candidate === f.audience);
  const kind = INTRA_KINDS.find((candidate) => candidate === f.kind);
  if (
    typeof f.organizerLogin !== 'string' ||
    !audience ||
    typeof f.maxPeople !== 'number' ||
    typeof f.waitingList !== 'boolean' ||
    !kind ||
    typeof f.unsubscribeHours !== 'number' ||
    !Array.isArray(f.keywords) ||
    !f.keywords.every((keyword): keyword is string => typeof keyword === 'string')
  ) {
    return null;
  }
  const dates: IntraDate[] = [];
  for (const entry of value.dates) {
    if (!isRecord(entry) || typeof entry.start !== 'string' || typeof entry.end !== 'string') {
      return null;
    }
    const title = optionalText(entry.title);
    const own = optionalText(entry.description);
    const place = optionalText(entry.location);
    if (title === INVALID || own === INVALID || place === INVALID) return null;
    const date: IntraDate = { start: entry.start, end: entry.end };
    if (title !== undefined) date.title = title;
    if (own !== undefined) date.description = own;
    if (place !== undefined) date.location = place;
    dates.push(date);
  }
  return {
    title,
    description,
    location,
    fields: {
      organizerLogin: f.organizerLogin,
      audience,
      maxPeople: f.maxPeople,
      waitingList: f.waitingList,
      kind,
      unsubscribeHours: f.unsubscribeHours,
      keywords: f.keywords,
    },
    dates,
  };
}

// ---- what the page shows -------------------------------------------------------------------------------------------

/** The fields the staff copies, in the order of the intra's form. The dates sit between "available for" and the
 * description: an event that repeats has one line of dates for each. */
export const COPY_FIELDS = [
  'organizerLogin',
  'name',
  'availableFor',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'description',
  'location',
  'maxPeople',
  'waitingList',
  'kind',
  'unsubscribeHours',
  'keywords',
] as const;

export type CopyField = (typeof COPY_FIELDS)[number];

/** The four fields that belong to a date. */
export const DATE_FIELDS = ['startDate', 'startTime', 'endDate', 'endTime'] as const satisfies readonly CopyField[];
export type DateField = (typeof DATE_FIELDS)[number];

/** `DD/MM/YYYY`, in the BDE's time zone, whatever the language of the interface: it is what the intra's form takes. */
export function intraDay(iso: string, timeZone: string): string {
  const { day, month, year } = toLocalDateTime(new Date(iso), timeZone);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** `HH:mm` in the BDE's time zone. */
export function intraTime(iso: string, timeZone: string): string {
  const { hour, minute } = toLocalDateTime(new Date(iso), timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The four values to copy for a date. */
export function dateValues(date: IntraDate, timeZone: string): Record<DateField, string> {
  return {
    startDate: intraDay(date.start, timeZone),
    startTime: intraTime(date.start, timeZone),
    endDate: intraDay(date.end, timeZone),
    endTime: intraTime(date.end, timeZone),
  };
}

/** The value of a field that is not a date, as plain text to copy; the audience and the waiting list are given as words by
 * the caller (they are translated). */
export function fieldValue(
  content: IntraContent,
  field: Exclude<CopyField, DateField>,
  words: { audience: (audience: IntraAudience) => string; waitingList: (value: boolean) => string },
): string {
  const { fields } = content;
  switch (field) {
    case 'organizerLogin':
      return fields.organizerLogin;
    case 'name':
      return content.title;
    case 'availableFor':
      return words.audience(fields.audience);
    case 'description':
      return content.description;
    case 'location':
      return content.location;
    case 'maxPeople':
      return String(fields.maxPeople);
    case 'waitingList':
      return words.waitingList(fields.waitingList);
    case 'kind':
      return fields.kind;
    case 'unsubscribeHours':
      return String(fields.unsubscribeHours);
    case 'keywords':
      return fields.keywords.join(', ');
  }
}

/** What differs between what the intra holds and what the event is now. */
export interface ContentChange {
  /** The fields that are not dates, with the value on the intra and the value now (as `fieldValue` writes them). */
  fields: { field: Exclude<CopyField, DateField>; before: string; after: string }[];
  /** Dates the intra holds that the event no longer has, and dates it has that the intra does not. A date that moved is both. */
  removed: IntraDate[];
  added: IntraDate[];
  /** Dates that stay but whose own title, description or place changed. */
  edited: { before: IntraDate; after: IntraDate }[];
}

const dateKey = (date: IntraDate) => `${date.start}|${date.end}`;
const ownText = (date: IntraDate) =>
  JSON.stringify([date.title ?? null, date.description ?? null, date.location ?? null]);

export function diffContent(
  before: IntraContent,
  after: IntraContent,
  words: { audience: (audience: IntraAudience) => string; waitingList: (value: boolean) => string },
): ContentChange {
  const fields: ContentChange['fields'] = [];
  for (const field of COPY_FIELDS) {
    if ((DATE_FIELDS as readonly string[]).includes(field)) continue;
    const name = field as Exclude<CopyField, DateField>;
    const was = fieldValue(before, name, words);
    const now = fieldValue(after, name, words);
    if (was !== now) fields.push({ field: name, before: was, after: now });
  }
  const earlier = new Map(before.dates.map((date) => [dateKey(date), date] as const));
  const later = new Map(after.dates.map((date) => [dateKey(date), date] as const));
  return {
    fields,
    removed: before.dates.filter((date) => !later.has(dateKey(date))),
    added: after.dates.filter((date) => !earlier.has(dateKey(date))),
    edited: after.dates.flatMap((date) => {
      const was = earlier.get(dateKey(date));
      return was && ownText(was) !== ownText(date) ? [{ before: was, after: date }] : [];
    }),
  };
}

export function isEmptyChange(change: ContentChange): boolean {
  return (
    change.fields.length === 0 &&
    change.removed.length === 0 &&
    change.added.length === 0 &&
    change.edited.length === 0
  );
}

// ---- answers ---------------------------------------------------------------------------------------------------------

/** The link the staff may give when publishing: an https address of the intra (any of its sites), nothing else. It is
 * shown to members, so it is read strictly (no credentials, no port, no other host) and written the way the database checks it. */
export const INTRA_URL_MAX_LENGTH = 300;

export function parseIntraUrl(
  input: unknown,
): { ok: true; value: string | null } | { ok: false } {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return { ok: true, value: null };
  if (text.length > INTRA_URL_MAX_LENGTH) return { ok: false };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false };
  }
  const host = url.hostname.toLowerCase();
  const onIntra = host === 'intra.42.fr' || host.endsWith('.intra.42.fr');
  if (
    url.protocol !== 'https:' ||
    !onIntra ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return { ok: false };
  }
  const value = url.href;
  // What the database accepts: no space, `<`, `>` or quote survives the normalisation, but say it twice.
  if (value.length > INTRA_URL_MAX_LENGTH || /[\s<>"]/.test(value)) return { ok: false };
  return { ok: true, value };
}
