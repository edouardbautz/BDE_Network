import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandRepeat, readRepeatRule } from '../src/lib/events/repeat';
import { directoryKey, type MentionDirectory } from '../src/lib/notifications/templates/mentions';
import { validateTemplate } from '../src/lib/notifications/templates/schema';
import type { TemplateType } from '../src/lib/notifications/templates/types';

/**
 * The invariants of a BDE's database (see `invariants.sql`), plus the ones that need the series engine: every date a
 * row of the database refers to (a cancellation, a date of its own, a reminder) must be a date its series really has.
 * That is what keeps the identifiers of the calendar files stable, and it is where a bug in cutting or moving a
 * series would show first. And every template of the notifications must be one the engine accepts for its type and its tab.
 */

/** The part of `pg`'s client these checks use (a `pg` Client or a Pool fits). */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Violation {
  invariant: string;
  detail: string;
}

// (the columns are `timestamp` without a zone, in UTC: `pg` would read them in the zone of the machine, so they are converted)
const SQL = readFileSync(join(__dirname, 'invariants.sql'), 'utf8');

export async function checkInvariants(
  db: Queryable,
  { timeZone = 'Europe/Paris' }: { timeZone?: string } = {},
): Promise<Violation[]> {
  await db.query(`SELECT set_config('qa.tz', $1, false)`, [timeZone]);
  const { rows } = await db.query(SQL);
  const violations: Violation[] = rows.map((row) => ({
    invariant: String(row.invariant),
    detail: String(row.detail),
  }));

  // Every date a row refers to is a date of its series.
  const { rows: series } = await db.query(
    `SELECT "id", ("startsAt" AT TIME ZONE 'UTC') AS "startsAt", ("endsAt" AT TIME ZONE 'UTC') AS "endsAt", "repeat", ("recurrenceUntil" AT TIME ZONE 'UTC') AS "recurrenceUntil" FROM "Event" WHERE "repeat" IS NOT NULL`,
  );
  const dates = new Map<string, Set<number>>();
  for (const event of series) {
    const rule = readRepeatRule(event.repeat);
    const startsAt = event.startsAt as Date;
    const endsAt = event.endsAt as Date;
    const until = event.recurrenceUntil as Date | null;
    if (!rule || !until) {
      violations.push({
        invariant: 'a_series_has_a_rule_the_engine_reads',
        detail: String(event.id),
      });
      continue;
    }
    const { occurrences } = expandRepeat(
      { startsAt, endsAt, repeat: rule, recurrenceUntil: until },
      timeZone,
    );
    dates.set(
      String(event.id),
      new Set(occurrences.map((occurrence) => occurrence.start.getTime())),
    );
  }
  for (const [table, invariant] of [
    ['EventOccurrence', 'a_date_of_its_own_is_a_date_of_its_series'],
    ['EventCancellation', 'a_cancelled_date_is_a_date_of_its_series'],
    ['EventReminder', 'a_reminded_date_is_a_date_of_its_series'],
  ] as const) {
    const { rows: references } = await db.query(
      `SELECT t."id", t."eventId", (t."occurrenceStart" AT TIME ZONE 'UTC') AS "occurrenceStart" FROM "${table}" t JOIN "Event" e ON e."id" = t."eventId" WHERE e."repeat" IS NOT NULL`,
    );
    for (const reference of references) {
      const known = dates.get(String(reference.eventId));
      if (!known?.has((reference.occurrenceStart as Date).getTime())) {
        violations.push({ invariant, detail: String(reference.id) });
      }
    }
  }

  // Every template is one the engine accepts, over the directory of people a BDE can mention: what is saved is checked again when
  // it is used, but a row the engine refuses is a notification that falls back on the platform's own.
  const { rows: people } = await db.query(
    `SELECT "key", "platform", "kind", "label", "externalId" FROM "NotificationMention"`,
  );
  const directory: Record<string, MentionDirectory[string]> = {};
  for (const person of people) {
    const platform = person.platform as 'discord' | 'slack';
    directory[directoryKey(platform, String(person.key))] = {
      platform,
      kind: person.kind as 'role' | 'user' | 'group',
      label: String(person.label),
      externalId: String(person.externalId),
    };
  }
  const { rows: templates } = await db.query(
    `SELECT "id", "type", "scope", "content" FROM "NotificationTemplate"`,
  );
  for (const template of templates) {
    const checked = validateTemplate(
      template.type as TemplateType,
      template.scope as 'all' | 'discord' | 'slack' | 'email',
      template.content,
      directory,
    );
    if (!checked.ok) {
      violations.push({
        invariant: 'a_template_is_valid_for_the_engine',
        detail: `${template.id} (${checked.issues[0]?.path}: ${checked.issues[0]?.code})`,
      });
    }
  }
  return violations;
}

/** The violations, one per line, for a log or a failure message. */
export function describeViolations(violations: readonly Violation[]): string {
  const byInvariant = new Map<string, string[]>();
  for (const violation of violations) {
    byInvariant.set(violation.invariant, [
      ...(byInvariant.get(violation.invariant) ?? []),
      violation.detail,
    ]);
  }
  return [...byInvariant]
    .map(
      ([name, details]) =>
        `${name}: ${details.length} (${details.slice(0, 5).join(', ')}${details.length > 5 ? ', …' : ''})`,
    )
    .join('\n');
}
