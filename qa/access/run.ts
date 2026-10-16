import { appendFileSync, writeFileSync } from 'node:fs';
import { PERSONAS, PLATFORM_VARIANTS, type PersonaKey, type PlatformVariant } from '../personas';
import {
  changedTables,
  describeExpect,
  describeObserved,
  observe,
  platformFromEnvironment,
  satisfies,
  snapshot,
  withDatabase,
  type Observed,
} from './http';
import { checkManifest, playActions, readManifest } from './actions-run';
import { API, INLINE_ACTIONS, PAGES, type Probe, type RouteSpec } from './matrix';

/**
 * Plays the access matrix against a running platform (`sh qa/platform.sh up`): every page and API route, as every
 * persona. The platform must have been started in the variant given by `--variant` (the expectation depends on it).
 *
 *   tsx qa/access/run.ts --variant events-enabled [--report report.json]
 *
 * Exit code 1 when a cell does not match, or when the requests changed anything in the database (reading changes
 * nothing, whoever reads).
 */

interface Cell {
  route: string;
  probe: string;
  persona: PersonaKey;
  expected: string;
  observed: string;
  ok: boolean;
}

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

export async function playRoutes(
  variant: PlatformVariant,
): Promise<{ cells: Cell[]; changed: string[] }> {
  const platform = platformFromEnvironment();

  return withDatabase(platform, async (db) => {
    // The links of the subscription feeds are credentials: they are read from the database, as a member would copy them.
    const { rows } = await db.query(
      `SELECT "login", "calendarToken" FROM "User" WHERE "calendarToken" IS NOT NULL`,
    );
    const tokens = new Map(rows.map((row) => [String(row.login), String(row.calendarToken)]));
    const resolve = (path: string) =>
      path.replace(/feed-of:(\w+)/, (_match, key: string) => {
        const login = PERSONAS.find((candidate) => candidate.key === key)?.login;
        const token = login ? tokens.get(login) : undefined;
        if (!token) throw new Error(`no feed token for ${key}`);
        return token;
      });

    // What an answer that refuses must never hold: the addresses of the members, and every feed link.
    const secrets = ['@example.org', ...tokens.values()];
    const before = await snapshot(db);
    const cells: Cell[] = [];

    const play = async (spec: RouteSpec, isPage: boolean) => {
      for (const probe of spec.probes as readonly Probe[]) {
        if (probe.variants && !probe.variants.includes(variant)) continue;
        for (const who of PERSONAS) {
          const expected = probe.expect(who.key, variant);
          let seen: Observed;
          try {
            seen = await observe(platform, who.key, resolve(probe.path), isPage, {}, secrets);
          } catch (error) {
            seen = { kind: 'error', status: 0 };
            console.error(`request failed: ${probe.path}`, error);
          }
          cells.push({
            route: spec.route,
            probe: probe.label,
            persona: who.key,
            expected: describeExpect(expected),
            observed: describeObserved(seen),
            ok: seen.kind !== 'error' && satisfies(expected, seen),
          });
        }
      }
    };

    for (const spec of PAGES) await play(spec, true);
    for (const spec of API) await play(spec, false);

    return { cells, changed: changedTables(before, await snapshot(db)) };
  });
}

export function summarize(
  title: string,
  cells: readonly { ok: boolean }[],
  failures: string[],
): string {
  return [
    `### ${title}`,
    `${cells.length - failures.length} of ${cells.length} cells as expected.`,
    ...(failures.length > 0 ? ['', '```', ...failures.slice(0, 80), '```'] : []),
    '',
  ].join('\n');
}

async function main() {
  const variant = (flag('variant') ??
    process.env.QA_VARIANT ??
    'events-enabled') as PlatformVariant;
  if (!PLATFORM_VARIANTS.includes(variant))
    throw new Error(`--variant is one of ${PLATFORM_VARIANTS.join(', ')}`);
  const only = flag('only') ?? 'all';

  const { cells, changed } =
    only === 'actions' ? { cells: [], changed: [] as string[] } : await playRoutes(variant);
  const failures = cells
    .filter((cell) => !cell.ok)
    .map(
      (cell) =>
        `✗ ${cell.persona} ${cell.route} [${cell.probe}]: expected ${cell.expected}, got ${cell.observed}`,
    );
  const cellFailures = failures.length;
  if (changed.length > 0) failures.push(`✗ reading changed the database: ${changed.join(', ')}`);
  if (cells.length > 0) {
    console.log(
      `${cells.length - cellFailures} cells of ${cells.length} as expected (${variant}), ${PERSONAS.length} personas`,
    );
  }

  const actions = only === 'routes' ? [] : await playActions(variant);
  const actionFailures = actions
    .filter((cell) => !cell.ok)
    .map(
      (cell) =>
        `✗ ${cell.persona} ${cell.action} [${cell.label}]: expected ${cell.expected}, ${cell.detail}`,
    );
  failures.push(...actionFailures);
  if (only !== 'routes') {
    const declared = Object.values(INLINE_ACTIONS).reduce((sum, count) => sum + count, 0);
    failures.push(...checkManifest(readManifest(), declared).map((problem) => `✗ ${problem}`));
  }
  if (actions.length > 0) {
    console.log(
      `${actions.length - actionFailures.length} action cells of ${actions.length} as expected (${variant})`,
    );
  }
  for (const line of failures) console.error(line);

  const report = flag('report');
  if (report) writeFileSync(report, JSON.stringify({ variant, cells, actions }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      summarize(
        `Access matrix (${variant}): ${cells.length} cells of pages and routes, ${actions.length} of server actions`,
        [...cells, ...actions],
        failures,
      ),
    );
  }
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
