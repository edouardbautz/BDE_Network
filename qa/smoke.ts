import { appendFileSync } from 'node:fs';
import { Client } from 'pg';
import { checkInvariants, describeViolations } from './invariants';
import { tableCell } from './markdown';
import { cookieHeaderFor, persona, type PersonaKey } from './personas';

/**
 * The first thing every quality run does on a platform made by `platform.sh`: is it up, does it tell the personas
 * apart, and does its database hold the invariants. It is deliberately small: the exhaustive suites (the access matrix,
 * security, accessibility...) build on the same platform and are separate.
 *
 *   QA_BASE_URL=... QA_AUTH_SECRET=... QA_DATABASE_URL=... tsx qa/smoke.ts
 */

const base = process.env.QA_BASE_URL;
const secret = process.env.QA_AUTH_SECRET;
const databaseUrl = process.env.QA_DATABASE_URL;
if (!base || !secret || !databaseUrl) {
  console.error(
    'QA_BASE_URL, QA_AUTH_SECRET and QA_DATABASE_URL are needed (sh qa/platform.sh env)',
  );
  process.exit(2);
}

interface Answer {
  status: number;
  /** The path the answer sends to, when it redirects. */
  to: string | null;
}

async function get(path: string, as: PersonaKey): Promise<Answer> {
  const cookie = await cookieHeaderFor(persona(as), secret as string);
  const response = await fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
  const location = response.headers.get('location');
  return { status: response.status, to: location ? new URL(location, base).pathname : null };
}

const results: { name: string; ok: boolean; detail: string }[] = [];
async function expectAnswer(
  name: string,
  path: string,
  as: PersonaKey,
  wanted: (answer: Answer) => boolean,
  wording: string,
) {
  const answer = await get(path, as);
  results.push({
    name,
    ok: wanted(answer),
    detail: `${as} ${path} → ${answer.status}${answer.to ? ` ${answer.to}` : ''} (expected ${wording})`,
  });
}

const redirectsTo = (path: string) => (answer: Answer) =>
  answer.status >= 300 && answer.status < 400 && answer.to === path;
const isOk = (answer: Answer) => answer.status === 200;

async function main() {
  const health = await fetch(`${base}/api/health`);
  results.push({
    name: 'the platform is up',
    ok: health.status === 200,
    detail: `/api/health → ${health.status}`,
  });

  await expectAnswer('the login page is public', '/fr', 'anonymous', isOk, '200');
  await expectAnswer(
    'a visitor is sent to the login page',
    '/fr/dashboard',
    'anonymous',
    redirectsTo('/fr'),
    'a redirect to /fr',
  );
  await expectAnswer('a member reads the dashboard', '/fr/dashboard', 'member', isOk, '200');
  await expectAnswer(
    'a pending account is sent to the waiting page',
    '/fr/dashboard',
    'pending',
    redirectsTo('/fr/pending'),
    'a redirect to /fr/pending',
  );
  await expectAnswer(
    'a removed member is signed out',
    '/fr/dashboard',
    'deleted',
    redirectsTo('/fr'),
    'a redirect to /fr',
  );
  await expectAnswer('an owner reads the dashboard', '/fr/dashboard', 'owner', isOk, '200');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let counts: Record<string, number> = {};
  try {
    const violations = await checkInvariants(client);
    results.push({
      name: 'the invariants of the database hold',
      ok: violations.length === 0,
      detail: violations.length === 0 ? 'no violation' : describeViolations(violations),
    });
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM "User")::int AS users, (SELECT count(*) FROM "Event")::int AS events, (SELECT count(*) FROM "AuditLog")::int AS audit`,
    );
    counts = {
      users: Number(rows[0]?.users),
      events: Number(rows[0]?.events),
      audit: Number(rows[0]?.audit),
    };
  } finally {
    await client.end();
  }

  for (const result of results)
    console.log(`${result.ok ? '✓' : '✗'} ${result.name}: ${result.detail}`);
  const failed = results.filter((result) => !result.ok);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### QA smoke test',
        `Platform with ${counts.users ?? '?'} accounts, ${counts.events ?? '?'} events, ${counts.audit ?? '?'} audit entries.`,
        '',
        '| | check | detail |',
        '|---|---|---|',
        ...results.map(
          (result) =>
            `| ${result.ok ? '✅' : '❌'} | ${result.name} | ${tableCell(result.detail)} |`,
        ),
        '',
      ].join('\n'),
    );
  }
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
