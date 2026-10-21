import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { cookieHeaderFor, persona, type PersonaKey } from '../personas';
import {
  markdownReport,
  mebibytesUsed,
  memoryVerdict,
  pagesOf,
  totalsOf,
  type K6Summary,
} from './report';

/**
 * The load of the platform: k6 (a pinned image) plays `k6/browse.js` against the platform made by `qa/platform.sh`, from the
 * network of that platform. Who asks is the personas, with their forged cookies, and the calendar feed of a member.
 *
 *   sh qa/platform.sh up && eval "$(sh qa/platform.sh env)" && npx tsx qa/perf/load.ts [--vus 20] [--duration 40s]
 *
 * It ends with k6's own status when a limit of the script is crossed (a page too slow, too many failures), and with 1 when the
 * application holds more memory after the load than a small server can spare. The report is printed, and added to the summary
 * of the job when there is one.
 */

const K6_IMAGE = 'grafana/k6:2.3.0';
const NETWORK = process.env.QA_NETWORK ?? 'qa-net';
const APP_CONTAINER = process.env.QA_APP_CONTAINER ?? 'qa-app';
const MEMORY_LIMIT_MIB = Number(process.env.QA_MEMORY_LIMIT_MIB ?? 1024);

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is needed (eval "$(sh qa/platform.sh env)")`);
  return value;
}

function appMemory(): number {
  const result = spawnSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{.MemUsage}}', APP_CONTAINER],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) throw new Error(`docker stats failed: ${result.stderr}`);
  return mebibytesUsed(result.stdout.trim());
}

async function feedToken(databaseUrl: string): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ calendarToken: string | null }>(
      'SELECT "calendarToken" FROM "User" WHERE "login" = $1',
      [persona('member').login],
    );
    const token = rows[0]?.calendarToken;
    if (!token) throw new Error('the member of the QA dataset has no calendar link');
    return token;
  } finally {
    await client.end();
  }
}

/** The limits written in the script, to say in the report what each page was held to. */
function limitsOf(script: string): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const match of script.matchAll(/name: '([\w-]+)'[^}]*?p95: (\d+)/g))
    limits[match[1]!] = Number(match[2]);
  return limits;
}

async function main() {
  const secret = required('QA_AUTH_SECRET');
  const databaseUrl = required('QA_DATABASE_URL');
  const scriptPath = resolve(process.cwd(), 'qa/perf/k6/browse.js');

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const who of ['member', 'validator', 'proposer', 'owner'] as PersonaKey[]) {
    env[`COOKIE_${who.toUpperCase()}`] = (await cookieHeaderFor(persona(who), secret)) ?? '';
  }
  env.FEED_TOKEN = await feedToken(databaseUrl);

  const work = mkdtempSync(join(tmpdir(), 'bde-load-'));
  copyFileSync(scriptPath, join(work, 'browse.js'));
  // k6 runs as a user of its own in its image: it must read the script and write its summary in this folder (a temporary
  // folder is private to the one who made it).
  chmodSync(work, 0o777);
  chmodSync(join(work, 'browse.js'), 0o644);

  const before = appMemory();
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      NETWORK,
      '-v',
      `${work}:/work`,
      '-e',
      `BASE=http://${APP_CONTAINER}:3000`,
      '-e',
      `VUS=${flag('vus', '20')}`,
      '-e',
      `DURATION=${flag('duration', '40s')}`,
      '-e',
      'COOKIE_MEMBER',
      '-e',
      'COOKIE_VALIDATOR',
      '-e',
      'COOKIE_PROPOSER',
      '-e',
      'COOKIE_OWNER',
      '-e',
      'FEED_TOKEN',
      K6_IMAGE,
      'run',
      '--quiet',
      '--summary-export=/work/summary.json',
      '/work/browse.js',
    ],
    { env, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const after = appMemory();

  const summary = JSON.parse(readFileSync(join(work, 'summary.json'), 'utf8')) as K6Summary;
  const report = markdownReport(
    pagesOf(summary, limitsOf(readFileSync(scriptPath, 'utf8'))),
    totalsOf(summary),
    memoryVerdict(before, after, MEMORY_LIMIT_MIB),
  );
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

  if (!memoryVerdict(before, after, MEMORY_LIMIT_MIB).ok) {
    console.error(
      `the application holds ${Math.round(after)} MiB after the load (limit ${MEMORY_LIMIT_MIB})`,
    );
    process.exitCode = 1;
  }
  if (run.status !== 0) process.exitCode = run.status ?? 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
