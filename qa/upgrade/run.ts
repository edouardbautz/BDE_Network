import { appendFileSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { checkInvariants, describeViolations } from '../invariants';
import { tableCell } from '../markdown';
import { forgeSessionCookie, SESSION_COOKIE } from '../personas';
import { Report } from '../security/core';
import {
  diffCounts,
  diffFeeds,
  diffRoles,
  parseFeed,
  sameCounts,
  type FeedEvent,
  type RoleFacts,
} from './compare';
import { COUNTED_TABLES, fixtureSql, OCCURRENCE_TABLES, OLD } from './fixture';
import { CURRENT, fixtureSqlCurrent } from './fixture-proposals';
import { AUTH_SECRET, run, Stack } from './stack';
import { addWorktree, removeWorktree } from '../worktree.mjs';

/**
 * Updates, played the way the guide of upgrading says an operator does them: a platform of an old version with data in it, the
 * folder moved to the version under test, `docker compose up -d`, a check; then a backup and its restore, and the way back to
 * the old version with the copy the platform made by itself. What the old version says about its own data (its calendar feeds,
 * its roles, the rows of its tables) is the reference the new one is held to: no date moved, no right lost, nothing missing.
 *
 *   tsx qa/upgrade/run.ts --from 1.0.0|1.1.0|1.2.0|1.3.0|1.4.0 [--report report.json]
 *
 * The image of the version under test is built before (`docker build -t bde-network:local .`, the name of
 * `docker-compose.build.yml`); the old ones come from their tag (1.0.0 was never published: it is built from its folder, as its
 * compose file says) or from the registry. The folder is a worktree of this repository, thrown away at the end.
 */

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const VERSIONS = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0'] as const;

/**
 * From 1.3.0 on the schema is the one of today (the proposal circuit and the repeat rules, no migration after them): the old
 * version holds the data of `fixture-proposals.ts`, the update has nothing to migrate, so there is no conversion of the roles and
 * the platform makes no copy of its own; the way back is the backup the operator made. Before, the data is that of `fixture.ts`.
 */
const holdsProposals = (from: (typeof VERSIONS)[number]) => from === '1.3.0' || from === '1.4.0';

interface Facts {
  counts: Record<string, number>;
  roles: RoleFacts[];
  users: string[];
  events: string[];
  migrations: number;
}

async function readFacts(db: Client): Promise<Facts> {
  const present = new Set(
    (
      await db.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      )
    ).rows.map((row) => String(row.table_name)),
  );
  const counts: Record<string, number> = {};
  for (const table of [...COUNTED_TABLES, ...OCCURRENCE_TABLES]) {
    if (!present.has(table)) continue;
    counts[table] = Number(
      (await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0]?.n,
    );
  }
  const roles = (
    await db.query(`SELECT "name", "permissions" FROM "Role" ORDER BY "name"`)
  ).rows.map((row) => ({ name: String(row.name), permissions: row.permissions as string[] }));
  const users = (
    await db.query(
      `SELECT u."login" || '|' || u."status"::text || '|' || coalesce(r."name", '') AS v FROM "User" u LEFT JOIN "Role" r ON r."id" = u."roleId" ORDER BY 1`,
    )
  ).rows.map((row) => String(row.v));
  const events = (
    await db.query(
      `SELECT "title" || '|' || "status"::text || '|' || to_char("startsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS v FROM "Event" ORDER BY 1`,
    )
  ).rows.map((row) => String(row.v));
  const migrations = Number(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
      )
    ).rows[0]?.n,
  );
  return { counts, roles, users, events, migrations };
}

/** The calendar links of the fixture: a member, those who hold drafts and proposals in theirs, and the BDE's. */
const feedPaths = (proposals: boolean): Record<string, string> =>
  proposals
    ? {
        member: `/api/calendar/${CURRENT.tokens.member}`,
        proposer: `/api/calendar/${CURRENT.tokens.proposer}`,
        validator: `/api/calendar/${CURRENT.tokens.validator}`,
        bde: `/api/calendar/bde/${CURRENT.tokens.bde}`,
      }
    : {
        member: `/api/calendar/${OLD.tokens.member}`,
        treasurer: `/api/calendar/${OLD.tokens.treasurer}`,
        bde: `/api/calendar/bde/${OLD.tokens.bde}`,
      };

type Feeds = Record<string, FeedEvent[]>;

async function readFeeds(stack: Stack, paths: Record<string, string>): Promise<Feeds> {
  const result: Feeds = {};
  for (const [name, path] of Object.entries(paths)) {
    const response = await fetch(`${stack.base}${path}`, { signal: AbortSignal.timeout(30_000) });
    result[name] = response.status === 200 ? parseFeed(await response.text()) : [];
  }
  return result;
}

/**
 * The page that says "not found", once Next.js has started to stream a page: it marks itself (no-index and the fallback marker);
 * the words "Page not found" are in the payload of every page and say nothing.
 */
const isNotFound = (body: string): boolean =>
  /name="robots" content="noindex/.test(body) && /NEXT_HTTP_ERROR_FALLBACK/.test(body);

/** A page as a signed-in person (a cookie signed with the platform's own secret, kept through the update) asks for it. */
async function page(stack: Stack, path: string, login?: string) {
  const cookie = login ? `${SESSION_COOKIE}=${await forgeSessionCookie(login, AUTH_SECRET)}` : null;
  const response = await fetch(`${stack.base}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    body: await response.text(),
  };
}

export async function playUpgrade(from: (typeof VERSIONS)[number], report: Report): Promise<void> {
  const area = `upgrade from ${from}`;
  const check = (name: string, ok: boolean, detail = '') => report.check(area, name, ok, detail);
  const index = VERSIONS.indexOf(from);
  const proposals = holdsProposals(from);
  const paths = feedPaths(proposals);
  const sha = process.env.QA_UPGRADE_SHA ?? run('git', ['rev-parse', 'HEAD']).out;
  const dir = mkdtempSync(join(tmpdir(), `qa-upgrade-${from}-`));
  const project = run('git', ['rev-parse', '--show-toplevel']).out;
  try {
    addWorktree(project, dir, `v${from}`);
  } catch (error) {
    check(`the folder of version ${from} could be checked out`, false, String(error).slice(0, 300));
    return;
  }
  const stack = new Stack(dir, `qaupg${index}`, 3200 + index, 55440 + index);

  try {
    // ---- 1. the old platform, with its data ------------------------------------------------------------------------------
    stack.writeEnvironment();
    const builds = from === '1.0.0'; // never published: its compose file builds the image from the folder
    stack.prepare({ mountsConfig: from !== '1.0.0', build: false });
    const started = stack.up({ build: builds });
    check(`version ${from} starts`, started.ok, started.ok ? '' : started.out.slice(-400));
    const oldReady = await stack.healthy(builds ? 600 : 300);
    check(
      `version ${from} answers`,
      oldReady !== null,
      oldReady === null ? stack.logs(30).slice(-600) : `${Math.round(oldReady)} ms`,
    );
    if (oldReady === null) return;

    const hasOccurrences = await stack.database(async (db) => {
      const found = await db.query(`SELECT to_regclass('"EventOccurrence"') AS t`);
      return found.rows[0]?.t !== null;
    });
    await stack.database((db) =>
      db.query(proposals ? fixtureSqlCurrent() : fixtureSql({ occurrences: hasOccurrences })),
    );
    const before = await stack.database(readFacts);
    const feedsBefore = await readFeeds(stack, paths);
    const sizes = Object.entries(feedsBefore)
      .map(([name, feed]) => `${name} ${feed.length}`)
      .join(', ');
    check(
      `the old version gives calendar files with the data in them (the comparison below means something)`,
      (feedsBefore.member?.length ?? 0) >= (proposals ? 25 : 15) &&
        (feedsBefore.bde?.length ?? 0) >= (proposals ? 25 : 15),
      `${sizes} events`,
    );
    if (proposals) {
      const member = feedsBefore.member?.length ?? 0;
      const proposer = feedsBefore.proposer?.length ?? 0;
      const validator = feedsBefore.validator?.length ?? 0;
      check(
        'the old version tells the rights apart in its calendar files: a validator holds drafts and proposals, a proposer their own, a member neither',
        validator > proposer && proposer > member,
        `validator ${validator}, proposer ${proposer}, member ${member}`,
      );
      const held = await stack.database((db) => checkInvariants(db));
      check(
        'the data of the old version satisfies the invariants of the database (it is what a board could hold)',
        held.length === 0,
        held.length === 0 ? 'none broken' : describeViolations(held),
      );
    }

    // ---- 2. the backup an operator makes before updating ---------------------------------------------------------------------
    stack.ensureBackups();
    const backedUp = stack.script('backup.sh');
    const backupFile = readdirSync(join(dir, 'backups'))
      .filter((name) => name.startsWith('bde-backup-'))
      .sort()
      .pop();
    check(
      'the backup before the update is made',
      backedUp.ok,
      backedUp.ok ? '' : backedUp.out.slice(-300),
    );

    // ---- 3. the update: the new code, then docker compose up -d --------------------------------------------------------
    const switched = run('git', ['checkout', '--detach', '-f', sha], { cwd: dir });
    check('the folder is moved to the version under test', switched.ok, switched.out.slice(-300));
    stack.prepare({ mountsConfig: true, build: true });
    const updated = stack.up({ build: false });
    check(
      'docker compose up -d goes through',
      updated.ok,
      updated.ok ? '' : updated.out.slice(-500),
    );
    const newReady = await stack.healthy(300);
    check(
      'the platform answers after the update, within 5 minutes',
      newReady !== null,
      newReady === null ? stack.logs(40).slice(-800) : `${Math.round(newReady)} ms`,
    );
    if (newReady === null) return;

    const after = await stack.database(readFacts);
    const expectedMigrations = stack.migrationsHere();
    check(
      'every migration of the new version is applied',
      after.migrations === expectedMigrations,
      `${before.migrations} before, ${after.migrations} after, ${expectedMigrations} in the folder`,
    );
    const lost = diffCounts(before.counts, after.counts);
    check(
      'no row is lost, none appears by itself',
      lost.length === 0,
      lost.join('; ') || 'every table has its rows',
    );
    const roleProblems = diffRoles(before.roles, after.roles);
    check(
      proposals
        ? 'the roles are the same, right for right (proposing, validating, the shared calendar)'
        : 'the roles are the same, with events.manage converted and nothing else changed',
      roleProblems.length === 0,
      roleProblems.join('; ') || `${after.roles.length} roles`,
    );
    check(
      'the members are the same, with the same status and role',
      JSON.stringify(before.users) === JSON.stringify(after.users),
      JSON.stringify(after.users),
    );
    check(
      'the events are the same (title, status, first date)',
      JSON.stringify(before.events) === JSON.stringify(after.events),
      before.events.filter((event) => !after.events.includes(event)).join('; ') ||
        `${after.events.length} events`,
    );
    const feedsAfter = await readFeeds(stack, paths);
    for (const name of Object.keys(paths)) {
      const problems = diffFeeds(feedsBefore[name] ?? [], feedsAfter[name] ?? []);
      check(
        `the ${name} calendar file says the same thing before and after (every date, hour and cancellation)`,
        problems.length === 0,
        problems.slice(0, 5).join('; ') || `${feedsAfter[name]?.length} events`,
      );
    }
    if (!proposals) {
      const converted = await stack.database((db) =>
        db.query(
          `SELECT count(*)::int AS n FROM "AuditLog" WHERE "id" = 'audit-event-proposals-migration'`,
        ),
      );
      check(
        'the conversion of the roles is written in the audit log',
        Number(converted.rows[0]?.n) === 1,
        `${converted.rows[0]?.n} entry`,
      );
    }
    const violations = await stack.database((db) => checkInvariants(db));
    check(
      'the invariants of the database hold',
      violations.length === 0,
      violations.length === 0 ? 'none broken' : describeViolations(violations),
    );
    const copies = stack.compose('exec', '-T', 'app', 'ls', '/backups');
    check(
      proposals
        ? 'the platform made no copy of its own: there was nothing to migrate'
        : 'the platform made a copy of the database by itself before applying the migrations',
      /pre-update_/.test(copies.out) === !proposals,
      copies.out.slice(0, 200) || '(no copy)',
    );

    const owner = await page(stack, '/en/settings', OLD.owner);
    check(
      'the settings were copied into the database, and the owner reads them',
      owner.status === 200 && /Settings stored in the database/.test(owner.body),
      `${owner.status}`,
    );
    const member = await page(stack, '/en/dashboard', proposals ? CURRENT.member : OLD.member);
    check(
      'a member is still signed in with the cookie of before',
      member.status === 200 && !member.location,
      `${member.status} ${member.location ?? ''}`,
    );
    if (proposals) {
      const validator = await page(stack, '/en/events/review', CURRENT.validator);
      check(
        'the validator finds the proposals to validate, the one of a series included',
        validator.status === 200 &&
          !isNotFound(validator.body) &&
          validator.body.includes('Afterwork partenaires') &&
          validator.body.includes('Atelier cuisine du jeudi'),
        `${validator.status}`,
      );
      const proposer = await page(stack, '/en/events/review', CURRENT.proposer);
      check(
        'the one who only proposes still cannot validate',
        proposer.status === 404 || isNotFound(proposer.body) || proposer.location !== null,
        `${proposer.status} ${proposer.location ?? ''}`,
      );
      const refused = await page(stack, `/en/events/${CURRENT.events.refused}`, CURRENT.proposer);
      check(
        'the author of a refused proposal still reads the comment, whole',
        refused.status === 200 &&
          refused.body.includes('Voyage surprise') &&
          /Le budget n(&#x27;|')est pas voté/.test(refused.body) &&
          refused.body.includes('Merci de proposer une date plus tard'),
        `${refused.status}`,
      );
      const shared = await page(stack, '/en/events/shared-calendar', CURRENT.shared);
      check(
        'the holder of the shared calendar right still manages the link of the BDE',
        shared.status === 200 && !isNotFound(shared.body),
        `${shared.status}`,
      );
      const notShared = await page(stack, '/en/events/shared-calendar', CURRENT.proposer);
      check(
        'the one who only proposes still cannot manage it',
        notShared.status === 404 || isNotFound(notShared.body) || notShared.location !== null,
        `${notShared.status} ${notShared.location ?? ''}`,
      );
    } else {
      const treasurer = await page(stack, '/en/events/review', OLD.treasurer);
      check(
        'the treasurer, who could manage events, can validate them',
        treasurer.status === 200 && !isNotFound(treasurer.body),
        `${treasurer.status}`,
      );
      const reader = await page(stack, '/en/events/review', OLD.reader);
      check(
        'the reader, who could only view events, still cannot',
        reader.status === 404 || isNotFound(reader.body) || reader.location !== null,
        `${reader.status} ${reader.location ?? ''}`,
      );
    }
    const pending = await page(stack, '/en/dashboard', proposals ? CURRENT.pending : OLD.pending);
    check(
      'the person waiting is still kept on the waiting page',
      /pending/.test(pending.location ?? ''),
      `${pending.status} ${pending.location ?? ''}`,
    );

    // ---- 4. a backup of the new version, and its restore --------------------------------------------------------------
    const second = stack.script('backup.sh');
    check(
      'a backup of the new version is made, with the keys',
      second.ok && !/ATTENTION/.test(second.out),
      second.out.slice(-200),
    );
    const archives = readdirSync(join(dir, 'backups'));
    const dump = archives
      .filter((name) => name.startsWith('bde-backup-'))
      .sort()
      .pop();
    const keys = archives
      .filter((name) => name.startsWith('bde-secrets-'))
      .sort()
      .pop();
    await stack.database((db) =>
      db.query(
        `INSERT INTO "AuditLog" ("id","actorLogin","action","targetType","targetLabel") VALUES ('upg-after-backup','qa','test.after_backup','Test','written after the backup')`,
      ),
    );
    if (dump && keys) {
      const restored = stack.script(
        'restore.sh',
        join('backups', dump),
        '--secrets',
        join('backups', keys),
        '--yes',
      );
      check(
        'the restore of the backup goes through',
        restored.ok,
        restored.ok ? '' : restored.out.slice(-400),
      );
      const back = await stack.healthy(180);
      check(
        'the platform answers after the restore',
        back !== null,
        back === null ? stack.logs(30).slice(-500) : `${Math.round(back)} ms`,
      );
      if (back !== null) {
        const restoredFacts = await stack.database(readFacts);
        const problems = sameCounts(after.counts, restoredFacts.counts);
        const extra = await stack.database((db) =>
          db.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE "id" = 'upg-after-backup'`),
        );
        check(
          'the restore puts the database back exactly as it was at the backup',
          problems.length === 0 && Number(extra.rows[0]?.n) === 0,
          problems.join('; ') || 'the row written after the backup is gone',
        );
      }
    } else {
      check(
        'the backup produced a database archive and an archive of the keys',
        false,
        JSON.stringify(archives),
      );
    }

    // ---- 5. the way back: the copy the platform made, then the old version ------------------------------------------------
    // The platform keeps a copy of its own only when it migrates; 1.1.0's cannot be put back by `--pre-update`, and from 1.3.0 on there is none.
    const fromArchive = from === '1.1.0' || proposals;
    const rolledBack = fromArchive
      ? stack.script('restore.sh', join('backups', backupFile ?? 'missing'), '--no-start', '--yes')
      : stack.script('restore.sh', '--pre-update', '--yes');
    check(
      fromArchive
        ? 'the backup made before the update is put back, the application left stopped'
        : 'the copy the platform made before the update is put back',
      rolledBack.ok,
      rolledBack.ok ? '' : rolledBack.out.slice(-400),
    );
    const old = await stack.database(readFacts);
    check(
      'the database is at the old version again (same migrations, same rows)',
      old.migrations === before.migrations && sameCounts(before.counts, old.counts).length === 0,
      `${old.migrations} migrations, ${JSON.stringify(old.counts)}`,
    );
    check(
      proposals
        ? 'the roles are the old ones'
        : 'the roles are the old ones, events.manage included',
      JSON.stringify(old.roles) === JSON.stringify(before.roles),
      JSON.stringify(old.roles),
    );

    run('git', ['checkout', '--detach', '-f', `v${from}`], { cwd: dir });
    stack.prepare({ mountsConfig: from !== '1.0.0', build: false });
    const again = stack.up({ build: false });
    check(
      `version ${from} starts again on the restored database`,
      again.ok,
      again.ok ? '' : again.out.slice(-400),
    );
    const againReady = await stack.healthy(300);
    check(
      `version ${from} answers again`,
      againReady !== null,
      againReady === null ? stack.logs(40).slice(-600) : `${Math.round(againReady)} ms`,
    );
    if (againReady !== null) {
      const feedsAgain = await readFeeds(stack, paths);
      for (const name of Object.keys(paths)) {
        const problems = diffFeeds(feedsBefore[name] ?? [], feedsAgain[name] ?? []);
        check(
          `the old version gives the same ${name} calendar file as before the update`,
          problems.length === 0,
          problems.slice(0, 5).join('; ') || `${feedsAgain[name]?.length} events`,
        );
      }
    }
  } finally {
    stack.down();
    removeWorktree(project, dir);
  }
}

async function main() {
  const from = flag('from');
  if (!from || !(VERSIONS as readonly string[]).includes(from))
    throw new Error(`--from ${VERSIONS.join('|')}`);
  const report = new Report();
  const started = Date.now();
  await playUpgrade(from as (typeof VERSIONS)[number], report);
  console.log(`${report.checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const check of report.checks)
    console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);

  const path = flag('report');
  if (path) writeFileSync(path, JSON.stringify(report.checks, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `### Update from ${from}`,
        '',
        '| | check | seen |',
        '|---|---|---|',
        ...report.checks.map(
          (c) =>
            `| ${c.ok ? '✅' : '❌'} | ${tableCell(c.name)} | ${tableCell(c.detail.replace(/\n/g, ' ').slice(0, 400))} |`,
        ),
        '',
      ].join('\n'),
    );
  }
  if (report.failures.length > 0) {
    console.error(report.describeFailures());
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
