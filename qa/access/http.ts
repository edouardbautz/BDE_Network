import { Client } from 'pg';
import { cookieHeaderFor, persona, type PersonaKey } from '../personas';
import type { Expect } from './matrix';

/** What one request came to, in the terms of the matrix. */
export type Observed =
  | { kind: 'ok'; status: number; leaked?: string }
  | { kind: 'redirect'; status: number; to: string; leaked?: string }
  | { kind: 'notFound'; status: number; leaked?: string }
  | { kind: 'error'; status: number }
  | { kind: 'status'; status: number };

/**
 * Next.js starts streaming a page before it knows how it ends: a page that is not found, or that sends the visitor
 * elsewhere, then answers 200, and says so inside. The not-found page marks itself (no-index and the fallback marker; the
 * words "Page introuvable" are in the payload of every page, so they say nothing), a redirect is a meta refresh.
 */
const NOT_FOUND_MARKERS = [/name="robots" content="noindex/, /NEXT_HTTP_ERROR_FALLBACK/];
const REDIRECT_META =
  /<meta id="__next-page-redirect" http-equiv="refresh" content="\d+;url=([^"]+)"/;

export interface Platform {
  base: string;
  secret: string;
  databaseUrl: string;
}

export function platformFromEnvironment(): Platform {
  const { QA_BASE_URL: base, QA_AUTH_SECRET: secret, QA_DATABASE_URL: databaseUrl } = process.env;
  if (!base || !secret || !databaseUrl) {
    throw new Error(
      'QA_BASE_URL, QA_AUTH_SECRET and QA_DATABASE_URL are needed (sh qa/platform.sh env)',
    );
  }
  return { base, secret, databaseUrl };
}

/** A request as a persona makes it. `isPage` decides how an answer is read: a page, or an API route. */
export async function observe(
  platform: Platform,
  who: PersonaKey,
  path: string,
  isPage: boolean,
  init: RequestInit = {},
  /** Texts that must never be in an answer that refuses (the data of other people: addresses, links). */
  secrets: readonly string[] = [],
): Promise<Observed> {
  const cookie = await cookieHeaderFor(persona(who), platform.secret);
  const response = await fetch(`${platform.base}${path}`, {
    redirect: 'manual',
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const status = response.status;
  const location = response.headers.get('location');
  if (status >= 300 && status < 400 && location) {
    return { kind: 'redirect', status, to: new URL(location, platform.base).pathname };
  }
  if (!isPage) return { kind: 'status', status };
  if (status >= 500) return { kind: 'error', status };
  const body = await response.text();
  const leaked = secrets.find((secret) => body.includes(secret));
  const withLeak = leaked ? { leaked } : {};
  const meta = REDIRECT_META.exec(body);
  if (meta?.[1])
    return { kind: 'redirect', status, to: new URL(meta[1], platform.base).pathname, ...withLeak };
  if (status === 404 || NOT_FOUND_MARKERS.every((marker) => marker.test(body)))
    return { kind: 'notFound', status, ...withLeak };
  return { kind: 'ok', status };
}

export function satisfies(expected: Expect, seen: Observed): boolean {
  // A refusal that carries somebody's data is not a refusal.
  if (seen.kind !== 'error' && seen.kind !== 'status' && seen.kind !== 'ok' && seen.leaked)
    return false;
  switch (expected.kind) {
    case 'ok':
      return seen.kind === 'ok';
    case 'denied':
      return seen.kind === 'redirect' || seen.kind === 'notFound';
    case 'redirect':
      return seen.kind === 'redirect' && seen.to === expected.to;
    case 'notFound':
      return seen.kind === 'notFound';
    case 'status':
      return seen.kind === 'status' && expected.codes.includes(seen.status);
  }
}

export const describeExpect = (expected: Expect): string =>
  expected.kind === 'redirect'
    ? `a redirect to ${expected.to}`
    : expected.kind === 'status'
      ? `status ${expected.codes.join(' or ')}`
      : expected.kind === 'denied'
        ? 'a refusal (not found, or sent elsewhere)'
        : expected.kind;

export const describeObserved = (seen: Observed): string =>
  'leaked' in seen && seen.leaked
    ? `${seen.kind} (${seen.status}) THAT CARRIES "${seen.leaked.slice(0, 12)}…"`
    : seen.kind === 'redirect'
      ? `a redirect to ${seen.to}`
      : seen.kind === 'status'
        ? `status ${seen.status}`
        : `${seen.kind} (${seen.status})`;

// ---- the database --------------------------------------------------------------------------------------------------

const TABLES = [
  'User',
  'Role',
  'AuditLog',
  'Event',
  'EventAssignee',
  'EventCancellation',
  'EventOccurrence',
  'EventOccurrenceAssignee',
  'EventReminder',
  'BdeCalendarFeed',
  'PlatformSettings',
] as const;

/** A fingerprint of every table, to say whether a request changed anything and what. */
export async function snapshot(db: {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of TABLES) {
    const { rows } = await db.query(
      `SELECT coalesce(md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))), 'empty') AS hash, count(*)::int AS rows FROM "${table}" t`,
    );
    result[table] = `${rows[0]?.hash}/${rows[0]?.rows}`;
  }
  return result;
}

/**
 * What the platform writes by itself while it runs, whoever asks for what: the reminder loop (`scheduler.ts`) claims the
 * reminder of a date that has become due, which is right and has nothing to do with a request. (Found by the nightly run:
 * the platform's clock moves while the dataset's "today" does not, so some night an event is due tomorrow.) Everything
 * else must be written by a request, and only by an allowed one.
 */
export const BACKGROUND_WRITES: readonly string[] = ['EventReminder'];

export const changedTables = (
  before: Record<string, string>,
  after: Record<string, string>,
): string[] =>
  TABLES.filter((table) => !BACKGROUND_WRITES.includes(table) && before[table] !== after[table]);

export async function withDatabase<T>(
  platform: Platform,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: platform.databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
