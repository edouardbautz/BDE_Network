/**
 * What an update must leave as it was, and how that is told: pure functions (tested on their own, `compare.test.ts`), so that a
 * comparison that cannot fail is found out. The old version and the new one are asked the same questions about the same data
 * (the calendar feeds, the roles, the tables); the answers are compared here.
 */

export interface FeedEvent {
  uid: string;
  /** The properties that say when, what and where, as the calendar file wrote them (the parameters of a property are kept). */
  properties: Record<string, string>;
}

/** Written by the moment the file is made, never by the data: they would differ on every request. */
const IGNORED = new Set(['DTSTAMP', 'CREATED', 'LAST-MODIFIED', 'SEQUENCE']);

/** The VEVENTs of a calendar file, lines unfolded, as {uid, properties}. */
export function parseFeed(ics: string): FeedEvent[] {
  const lines = ics
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const events: FeedEvent[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT') {
      if (current) events.push({ uid: current.UID ?? '(no UID)', properties: current });
      current = null;
    } else if (current && line.includes(':')) {
      const colon = line.indexOf(':');
      const name = line.slice(0, colon);
      if (!IGNORED.has(name.split(';')[0] ?? name)) current[name] = line.slice(colon + 1);
    }
  }
  return events;
}

/** What differs between two calendar files: events that disappeared, appeared, or say something else. */
export function diffFeeds(before: readonly FeedEvent[], after: readonly FeedEvent[]): string[] {
  const problems: string[] = [];
  const afterByUid = new Map(after.map((event) => [event.uid, event]));
  const beforeByUid = new Map(before.map((event) => [event.uid, event]));
  for (const event of before) {
    const other = afterByUid.get(event.uid);
    if (!other) {
      problems.push(
        `gone: ${event.uid} (${event.properties.SUMMARY ?? '?'} ${event.properties.DTSTART ?? ''})`,
      );
      continue;
    }
    for (const name of new Set([
      ...Object.keys(event.properties),
      ...Object.keys(other.properties),
    ])) {
      if (event.properties[name] !== other.properties[name])
        problems.push(
          `changed: ${event.uid} ${name}: ${event.properties[name] ?? '(none)'} → ${other.properties[name] ?? '(none)'}`,
        );
    }
  }
  for (const event of after)
    if (!beforeByUid.has(event.uid))
      problems.push(
        `new: ${event.uid} (${event.properties.SUMMARY ?? '?'} ${event.properties.DTSTART ?? ''})`,
      );
  return problems;
}

/**
 * What a role holds after the move to proposing and validating events (the migration `event_proposals`, written in its header):
 * `events.manage` becomes `events.validate`, which includes `events.propose` and `events.view`; the list stays sorted; nothing
 * else changes and nobody loses a right.
 */
export function migratedPermissions(before: readonly string[]): string[] {
  if (!before.includes('events.manage')) return [...before].sort();
  return [
    ...new Set([
      ...before.filter((permission) => permission !== 'events.manage'),
      'events.propose',
      'events.validate',
      'events.view',
    ]),
  ].sort();
}

export interface RoleFacts {
  name: string;
  permissions: readonly string[];
}

/** The roles after an update against the roles before it, through the one conversion the migrations make. */
export function diffRoles(before: readonly RoleFacts[], after: readonly RoleFacts[]): string[] {
  const problems: string[] = [];
  const afterByName = new Map(after.map((role) => [role.name, role]));
  for (const role of before) {
    const other = afterByName.get(role.name);
    if (!other) {
      problems.push(`role gone: ${role.name}`);
      continue;
    }
    const expected = migratedPermissions(role.permissions);
    const seen = [...other.permissions].sort();
    if (JSON.stringify(expected) !== JSON.stringify(seen))
      problems.push(
        `role ${role.name}: expected ${expected.join(',') || '(none)'}, found ${seen.join(',') || '(none)'}`,
      );
  }
  const names = new Set(before.map((role) => role.name));
  for (const role of after) if (!names.has(role.name)) problems.push(`role appeared: ${role.name}`);
  return problems;
}

/**
 * The rows of each table after an update against before it. Nothing may be lost; a table the migrations write to by themselves
 * (the audit log, which records what they converted) may have more.
 */
export function diffCounts(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  mayGrow: readonly string[] = ['AuditLog'],
): string[] {
  const problems: string[] = [];
  for (const [table, count] of Object.entries(before)) {
    const now = after[table];
    if (now === undefined) problems.push(`${table}: the table is gone (${count} rows before)`);
    else if (now < count) problems.push(`${table}: ${count} rows before, ${now} after`);
    else if (now > count && !mayGrow.includes(table))
      problems.push(`${table}: ${count} rows before, ${now} after (rows appeared)`);
  }
  return problems;
}

/** The same counts, strictly: after a restore the database is exactly what it was. */
export function sameCounts(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): string[] {
  return diffCounts(before, after, []);
}

/**
 * The boxes ticked in a page, by their accessible name ("Event confirmed — Discord"): what the settings page shows of the
 * table of notifications. Read from the HTML the server sent, the way a browser would draw it.
 */
export function tickedBoxes(html: string): string[] {
  const decode = (text: string) =>
    text
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  const ticked: string[] = [];
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    if (!/\btype="checkbox"/.test(tag) || !/\schecked(=""|\s|\/|>)/.test(tag)) continue;
    const label = /\baria-label="([^"]*)"/.exec(tag)?.[1];
    if (label !== undefined) ticked.push(decode(label));
  }
  return ticked.sort();
}

/** What differs between the boxes expected and the boxes ticked: the missing and the unexpected, by name. */
export function diffBoxes(expected: readonly string[], seen: readonly string[]): string[] {
  const problems: string[] = [];
  for (const name of expected) if (!seen.includes(name)) problems.push(`not ticked: ${name}`);
  for (const name of seen) if (!expected.includes(name)) problems.push(`ticked by itself: ${name}`);
  return problems;
}
