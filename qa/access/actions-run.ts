import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES } from '../dataset';
import {
  cookieHeaderFor,
  persona,
  PERSONAS,
  type PersonaKey,
  type PlatformVariant,
} from '../personas';
import { resetDatabase } from '../reset';
import { CASES, type ActionCase, type Context } from './actions';
import {
  changedTables,
  platformFromEnvironment,
  snapshot,
  withDatabase,
  type Platform,
} from './http';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { encodeReply } = require('next/dist/compiled/react-server-dom-webpack/client.node');

/**
 * Calls every server action over HTTP the way the browser does (the id of the action in a `Next-Action` header, the
 * arguments encoded by Next's own encoder), as every persona, on a running platform. The list of the actions that exist
 * is the one of the image (`server-reference-manifest.json`), not a guess.
 */

interface ManifestEntry {
  exportedName: string;
  filename: string;
  workers: Record<string, unknown>;
}

/** Where the actions of each folder live, in the image's manifest. */
const FILE_OF: Record<string, RegExp> = {
  members: /\(app\)\/members\/actions\.ts$/,
  roles: /\(app\)\/roles\/actions\.ts$/,
  events: /\(app\)\/events\/actions\.ts$/,
  'shared-calendar': /shared-calendar\/actions\.ts$/,
  intra: /\(app\)\/events\/intra\/actions\.ts$/,
  profile: /\(app\)\/profile\/actions\.ts$/,
  settings: /\(app\)\/settings\/actions\.ts$/,
  notifications: /\(app\)\/notifications\/actions\.ts$/,
  setup: /\[locale\]\/setup\/actions\.ts$/,
  'dev-impersonation': /lib\/dev-impersonation-actions\.ts$/,
};

export function readManifest(
  container = process.env.QA_CONTAINER ?? 'qa-app',
): Record<string, ManifestEntry> {
  const target = join(mkdtempSync(join(tmpdir(), 'qa-manifest-')), 'manifest.json');
  execFileSync(
    'docker',
    ['cp', `${container}:/app/.next/server/server-reference-manifest.json`, target],
    {
      stdio: 'pipe',
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    },
  );
  return (JSON.parse(readFileSync(target, 'utf8')) as { node: Record<string, ManifestEntry> }).node;
}

/** The id of an action and a page it can be posted to (any page that holds it). */
export function locate(
  manifest: Record<string, ManifestEntry>,
  action: string,
): { id: string; page: string } {
  const [owner = '', name = ''] = action.split('.');
  const pattern = FILE_OF[owner];
  if (!pattern) throw new Error(`no file known for the actions of ${owner}`);
  const found = Object.entries(manifest).find(
    ([, entry]) => entry.exportedName === name && pattern.test(entry.filename),
  );
  if (!found) throw new Error(`${action} is not in the manifest of the image`);
  const [id, entry] = found;
  const worker = Object.keys(entry.workers)[0] ?? '';
  const page = worker
    .replace(/^app\//, '/')
    .replace('[locale]', 'fr')
    .replace(/\/\([^/]*\)/g, '')
    .replace(/\/page$/, '')
    .replace('[id]', FIXTURES.events.confirmed)
    .replace('[...rest]', 'x');
  return { id, page: page || '/fr' };
}

export interface Call {
  status: number;
  /** An action that throws (a refusal is one) answers 500 and says nothing else. */
  threw: boolean;
  /** What the platform answered (the payload of the action, for the suites that read it). */
  text: string;
}

export async function callAction(
  platform: Platform,
  who: PersonaKey,
  id: string,
  page: string,
  args: unknown[],
  /** Headers on top of the usual ones, for a request a browser would not make (another origin, for instance). */
  extraHeaders: Record<string, string> = {},
  /** A platform that never answers is a failure, not a call that waits for ever. */
  timeoutMs = 120_000,
): Promise<Call> {
  const body = await encodeReply(args);
  const cookie = await cookieHeaderFor(persona(who), platform.secret);
  const response = await fetch(`${platform.base}${page}`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Next-Action': id,
      Accept: 'text/x-component',
      ...(typeof body === 'string' ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {}),
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body,
  });
  const text = await response.text();
  return { status: response.status, threw: response.status >= 500, text };
}

export interface ActionCell {
  action: string;
  label: string;
  persona: PersonaKey;
  /** What was expected of this persona. */
  expected: 'allowed' | 'refused';
  ok: boolean;
  detail: string;
}

async function seriesStart(db: {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<number> {
  const { rows } = await db.query(
    `SELECT extract(epoch FROM ("startsAt" AT TIME ZONE 'UTC')) * 1000 AS ms FROM "Event" WHERE "id" = '${FIXTURES.events.series}'`,
  );
  return Number(rows[0]?.ms);
}

/** The version of each event with a request, as the dataset recorded it (the hash the page of the request shows to the staff). */
async function intraHashes(db: {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<Record<string, string>> {
  const { rows } = await db.query(`SELECT "eventId", "contentHash" FROM "IntraRequest"`);
  return Object.fromEntries(rows.map((row) => [String(row.eventId), String(row.contentHash)]));
}

export async function playActions(variant: PlatformVariant): Promise<ActionCell[]> {
  const platform = platformFromEnvironment();
  const manifest = readManifest();
  const cells: ActionCell[] = [];

  await withDatabase(platform, async (db) => {
    await resetDatabase(db);
    const context: Context = {
      seriesStart: await seriesStart(db),
      intraHashes: await intraHashes(db),
    };
    const located = new Map(CASES.map((item) => [item, locate(manifest, item.action)]));

    // 1. Every persona that must be refused is refused: nothing changes in the database, and where the gate is the
    //    first thing the action does, it throws.
    for (const item of CASES) {
      const { id, page } = located.get(item) as { id: string; page: string };
      await item.prepare?.(db, context);
      for (const who of PERSONAS) {
        if (item.allowed(who.key, variant)) continue;
        const before = await snapshot(db);
        const call = await callAction(platform, who.key, id, page, item.args(context));
        const changed = changedTables(before, await snapshot(db));
        const failure =
          changed.length > 0
            ? `changed ${changed.join(', ')}`
            : item.strictThrow && call.status < 400
              ? `answered ${call.status} instead of refusing (an error status)`
              : null;
        cells.push({
          action: item.action,
          label: item.label,
          persona: who.key,
          expected: 'refused',
          ok: failure === null,
          detail: failure ?? `refused (${call.status})`,
        });
        if (changed.length > 0) await resetDatabase(db).then(() => item.prepare?.(db, context));
      }
    }

    // 2. The least privileged persona that is allowed gets through, and so does the owner (a gate that forgets the
    //    owner is as wrong as one that forgets nobody).
    for (const item of CASES) {
      const { id, page } = located.get(item) as { id: string; page: string };
      const allowed = PERSONAS.map((who) => who.key).filter((who) => item.allowed(who, variant));
      const chosen = [
        ...new Set([allowed[0], allowed.includes('owner') ? 'owner' : undefined]),
      ].filter((who): who is PersonaKey => who !== undefined);
      for (const who of chosen) {
        await resetDatabase(db);
        await item.prepare?.(db, context);
        const before = await snapshot(db);
        const call = await callAction(platform, who, id, page, item.args(context));
        const changed = changedTables(before, await snapshot(db));
        const effect = item.effect ?? [];
        const missing = effect.filter((table) => !changed.includes(table));
        const passed =
          !call.threw &&
          (item.control === 'answers' || (changed.length > 0 && missing.length === 0));
        cells.push({
          action: item.action,
          label: item.label,
          persona: who,
          expected: 'allowed',
          ok: passed,
          detail: passed
            ? `went through (${call.status}${changed.length ? `, changed ${changed.join(', ')}` : ''})`
            : call.threw
              ? `threw (${call.status}): the arguments of the matrix are wrong, or the gate refuses somebody it must not`
              : missing.length > 0
                ? `answered, but did not change ${missing.join(', ')}`
                : 'answered, but changed nothing',
        });
      }
    }
    await resetDatabase(db);
  });
  return cells;
}

export const actionsOf = (items: readonly ActionCase[]): string[] =>
  [...new Set(items.map((item) => item.action))].sort();

/**
 * The image's own list of entry points against the matrix: every action of the image is a case, and the actions
 * written inside components are the ones that are declared. Returns what is wrong, one line each.
 */
export function checkManifest(
  manifest: Record<string, ManifestEntry>,
  declaredInline: number,
): string[] {
  const problems: string[] = [];
  const known = new Set(CASES.map((item) => item.action));
  let inline = 0;
  for (const entry of Object.values(manifest)) {
    if (entry.exportedName.startsWith('$$RSC_SERVER_ACTION')) {
      inline += 1;
      continue;
    }
    const owner = Object.entries(FILE_OF).find(([, pattern]) => pattern.test(entry.filename))?.[0];
    if (!owner)
      problems.push(
        `the image holds an action in a file the matrix does not know: ${entry.filename} ${entry.exportedName}`,
      );
    else if (!known.has(`${owner}.${entry.exportedName}`))
      problems.push(`the image holds an action that has no case: ${owner}.${entry.exportedName}`);
  }
  if (inline !== declaredInline) {
    problems.push(
      `the image holds ${inline} actions written inside components, the matrix declares ${declaredInline}`,
    );
  }
  return problems;
}
