/**
 * Minimal RFC 5545 (iCalendar) writer. Times are emitted in UTC ("...Z") so no
 * VTIMEZONE is needed and every client shows them in the viewer's local zone.
 * Recurring events are exported as one VEVENT per occurrence rather than an
 * RRULE: cancelled occurrences and series edits then propagate for free.
 */

export interface IcsEvent {
  /** Stable across exports so calendar clients update rather than duplicate. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  /** DRAFT events are exported as TENTATIVE. */
  confirmed: boolean;
  category?: string | null;
  lastModified: Date;
  url?: string;
}

export interface IcsCalendar {
  name: string;
  events: IcsEvent[];
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatIcsDate(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds a content line to 75 octets per line, never splitting a UTF-8 character (§3.1). */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  // The first line may hold 75 octets; continuation lines 74 plus the leading space.
  let limit = 75;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (currentBytes + characterBytes > limit) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += character;
    currentBytes += characterBytes;
  }
  chunks.push(current);

  return chunks.join('\r\n ');
}

function eventLines(event: IcsEvent, stamp: Date): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatIcsDate(stamp)}`,
    `LAST-MODIFIED:${formatIcsDate(event.lastModified)}`,
    `DTSTART:${formatIcsDate(event.start)}`,
    `DTEND:${formatIcsDate(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `STATUS:${event.confirmed ? 'CONFIRMED' : 'TENTATIVE'}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.category) lines.push(`CATEGORIES:${escapeIcsText(event.category)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Serializes a calendar. Lines end with CRLF as the spec requires. */
export function buildIcs(calendar: IcsCalendar, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BDE Network//Events//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendar.name)}`,
    // Hint for subscribing clients; they are free to poll less often.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...calendar.events.flatMap((event) => eventLines(event, now)),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** `Soirée de rentrée` → `soiree-de-rentree.ics`: the name of the file a calendar client receives. */
export function icsFilename(title: string): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'event';
  return `${slug}.ics`;
}

/** UID of one occurrence: stable for a given event and original start. */
export function occurrenceUid(eventId: string, occurrenceStart: Date): string {
  return `${eventId}-${formatIcsDate(occurrenceStart)}@bde-network`;
}
