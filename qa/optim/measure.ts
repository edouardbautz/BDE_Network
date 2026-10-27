import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Client } from 'pg';
import { cookieHeaderFor, persona } from '../personas';
import { parseDu, parseHistory, parseStats, type Usage } from './docker';
import { assetsOf } from './html';
import { MEASURED_PAGES, type MeasuredPage } from './pages';
import { markdownOf } from './report';
import { median, round, spread } from './stats';
import { summarizeStatements, type StatementRow } from './sql';
import type {
  DbMeasure,
  GrowthMeasure,
  ImageMeasure,
  LoadMeasure,
  Measurement,
  PageMeasure,
  ServerMeasure,
  TableScan,
} from './types';

/**
 * The measures of the optimisation campaign, taken on the platform made by `qa/platform.sh` (the production image, a real PostgreSQL,
 * the QA dataset), so that the same numbers can be taken again before and after a change.
 *
 *   sh qa/platform.sh up --stats --now 2026-10-16T12:00:00Z && eval "$(sh qa/platform.sh env)"
 *   npx tsx qa/optim/measure.ts --label baseline [--only image,pages,db,server,growth] [--runs 15] [--out file.json]
 *
 * `--stats` is needed for `db` (it loads `pg_stat_statements` in PostgreSQL). Each axis is one function below; the numbers that do not
 * depend on the machine (bytes, number of statements) are the ones to compare across machines, the durations only on the same one.
 * It prints the measure as Markdown, and adds it to the summary of the job when there is one.
 */

const run = promisify(execFile);

const flag = (name: string, fallback?: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is needed (eval "$(sh qa/platform.sh env)")`);
  return value;
};

const APP = process.env.QA_APP_CONTAINER ?? 'qa-app';
const DATABASE = process.env.QA_DATABASE_CONTAINER ?? 'qa-postgres';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// -- HTTP ------------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  firstByteMs: number;
  totalMs: number;
  /** Bytes on the wire: the compressed body, as a browser downloads it. */
  wireBytes: number;
  body: Buffer;
}

const agent = new http.Agent({ keepAlive: true });

function get(base: string, path: string, cookie?: string): Promise<Answer> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = http.request(
      new URL(path, base),
      {
        agent,
        headers: { 'accept-encoding': 'gzip', ...(cookie ? { cookie } : {}) },
      },
      (response) => {
        const firstByteMs = performance.now() - started;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const wire = Buffer.concat(chunks);
          const encoding = response.headers['content-encoding'];
          const body =
            encoding === 'gzip'
              ? gunzipSync(wire)
              : encoding === 'br'
                ? brotliDecompressSync(wire)
                : wire;
          resolve({
            status: response.statusCode ?? 0,
            firstByteMs,
            totalMs: performance.now() - started,
            wireBytes: wire.length,
            body,
          });
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function cookieOf(who: MeasuredPage['who'], secret: string): Promise<string | undefined> {
  return (await cookieHeaderFor(persona(who), secret)) ?? undefined;
}

// -- pages -----------------------------------------------------------------------------------------------------------------

async function measurePages(base: string, secret: string, runs: number): Promise<PageMeasure[]> {
  /** The weight on the wire of a file of `/_next/static`, fetched once: every page shares them. */
  const assetBytes = new Map<string, number>();
  const weigh = async (paths: string[]) => {
    let bytes = 0;
    for (const path of paths) {
      if (!assetBytes.has(path)) assetBytes.set(path, (await get(base, path)).wireBytes);
      bytes += assetBytes.get(path)!;
    }
    return { count: paths.length, bytes };
  };

  const pages: PageMeasure[] = [];
  for (const page of MEASURED_PAGES) {
    const cookie = await cookieOf(page.who, secret);
    for (let warm = 0; warm < 2; warm += 1) await get(base, page.path, cookie);
    const firstByte: number[] = [];
    const total: number[] = [];
    let last = await get(base, page.path, cookie);
    for (let n = 0; n < runs; n += 1) {
      last = await get(base, page.path, cookie);
      firstByte.push(last.firstByteMs);
      total.push(last.totalMs);
    }
    if (last.status !== 200) console.error(`! ${page.name} answered ${last.status}, not 200`);
    const assets = assetsOf(last.body.toString('utf8'));
    pages.push({
      name: page.name,
      who: page.who,
      path: page.path,
      status: last.status,
      firstByteMs: spread(firstByte),
      totalMs: spread(total),
      htmlBytes: last.wireBytes,
      scripts: await weigh(assets.scripts),
      referencedScripts: await weigh(assets.referenced),
      stylesheets: await weigh(assets.stylesheets),
    });
  }
  return pages;
}

// -- database --------------------------------------------------------------------------------------------------------------

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: required('QA_DATABASE_URL') });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function measureDb(base: string, secret: string): Promise<DbMeasure[]> {
  return withDatabase(async (client) => {
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    } catch (error) {
      throw new Error(
        `pg_stat_statements is not available (${error instanceof Error ? error.message : error}): make the platform with "sh qa/platform.sh up --stats"`,
      );
    }
    const results: DbMeasure[] = [];
    for (const page of MEASURED_PAGES) {
      const cookie = await cookieOf(page.who, secret);
      await get(base, page.path, cookie); // the first request of a page does work the next ones do not
      const repetitions = [];
      for (let n = 0; n < 3; n += 1) {
        await client.query('SELECT pg_stat_statements_reset()');
        await get(base, page.path, cookie);
        await sleep(150); // work done after the answer (a notification, a claim) belongs to the page too
        const { rows } = await client.query<StatementRow>(
          `SELECT query, calls::int AS calls, total_exec_time AS "totalMs", rows::int AS rows
             FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`,
        );
        repetitions.push(summarizeStatements(rows));
      }
      const middle = [...repetitions].sort((a, b) => a.queries - b.queries)[1]!;
      results.push({
        name: page.name,
        queries: middle.queries,
        controls: middle.controls,
        totalMs: round(median(repetitions.map((r) => r.totalMs)), 2),
        repeated: middle.repeated,
        slowest: middle.slowest,
      });
    }
    return results;
  });
}

async function measureScans(base: string, secret: string): Promise<TableScan[]> {
  return withDatabase(async (client) => {
    await client.query('ANALYZE');
    await client.query('SELECT pg_stat_reset()');
    for (let pass = 0; pass < 3; pass += 1) {
      for (const page of MEASURED_PAGES)
        await get(base, page.path, await cookieOf(page.who, secret));
    }
    await sleep(1500); // the counters of a table are sent to the statistics when its session is idle for a moment
    const { rows } = await client.query<{
      table: string;
      rows: number;
      seq: number;
      seqRead: number;
      idx: number;
    }>(
      `SELECT relname AS "table",
              (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', relname), false, true, '')))[1]::text::int AS rows,
              seq_scan::int AS seq, seq_tup_read::bigint::float8 AS "seqRead", COALESCE(idx_scan, 0)::int AS idx
         FROM pg_stat_user_tables
        WHERE relname NOT LIKE '\\_%'
        ORDER BY seq_tup_read DESC LIMIT 10`,
    );
    return rows.map((r) => ({
      table: r.table,
      rows: r.rows,
      seqScans: r.seq,
      seqTuplesRead: r.seqRead,
      indexScans: r.idx,
    }));
  });
}

// -- growth ----------------------------------------------------------------------------------------------------------------

async function measureGrowth(): Promise<GrowthMeasure> {
  return withDatabase(async (client) => {
    const size = await client.query<{ bytes: string }>(
      'SELECT pg_database_size(current_database())::text AS bytes',
    );
    const { rows } = await client.query<{ table: string; bytes: string; rows: number }>(
      `SELECT c.relname AS "table", pg_total_relation_size(c.oid)::text AS bytes,
              (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', c.relname), false, true, '')))[1]::text::int AS rows
         FROM pg_class c
        WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        ORDER BY 2 DESC`,
    );
    const perYear: GrowthMeasure['perYear'] = [];
    for (const [table, column] of [
      ['AuditLog', 'createdAt'],
      ['Event', 'startsAt'],
      ['User', 'createdAt'],
    ] as const) {
      const { rows: years } = await client.query<{ year: number; rows: number }>(
        `SELECT extract(year FROM "${column}")::int AS year, count(*)::int AS rows FROM "${table}" GROUP BY 1 ORDER BY 1`,
      );
      for (const year of years) perYear.push({ table, year: year.year, rows: year.rows });
    }
    return {
      databaseBytes: Number(size.rows[0]!.bytes),
      tables: rows.map((r) => ({ table: r.table, bytes: Number(r.bytes), rows: r.rows })),
      perYear,
    };
  });
}

// -- image -----------------------------------------------------------------------------------------------------------------

async function measureImage(image: string): Promise<ImageMeasure> {
  const inspected = await run('docker', ['image', 'inspect', '--format', '{{.Size}}', image]);
  const history = await run(
    'docker',
    ['history', '--human=false', '--format', '{{.Size}}\t{{.CreatedBy}}', image],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  // The folders of the image, from inside it (as root: it reads what the application's user may not).
  const du = async (script: string) =>
    (
      await run(
        'docker',
        ['run', '--rm', '--user', 'root', '--entrypoint', 'sh', image, '-c', script],
        {
          maxBuffer: 16 * 1024 * 1024,
        },
      )
    ).stdout;
  const folders = parseDu(
    await du(
      'du -k -d 2 /app /opt /usr /lib /var 2>/dev/null; du -k -d 1 / 2>/dev/null | grep -v " /proc\\| /sys"',
    ),
  ).filter((use) => use.kib > 2048);
  const packages = parseDu(
    await du(
      'du -k -d 2 /app/node_modules 2>/dev/null; du -k -d 2 /opt/migrate/node_modules 2>/dev/null',
    ),
  )
    // a package is a folder of node_modules, or a folder of a scope (@prisma/client): not the scope itself
    .filter((use) => /node_modules\/(@[^/]+\/[^/]+|[^@/][^/]*)$/.test(use.path) && use.kib > 512)
    .slice(0, 30);
  const layers = parseHistory(history.stdout);
  return {
    name: image,
    // What `docker images` shows on a plain Docker (the sum of the layers): the size `inspect` gives depends on the image store
    // (Docker Desktop with containerd tells the compressed size).
    bytes: layers.reduce((sum, layer) => sum + layer.bytes, 0),
    inspectedBytes: Number(inspected.stdout.trim()),
    layers,
    folders: folders.slice(0, 25),
    packages,
  };
}

// -- server ----------------------------------------------------------------------------------------------------------------

async function usageOf(container: string): Promise<Usage> {
  const { stdout } = await run('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{.CPUPerc}}\t{{.MemUsage}}',
    container,
  ]);
  return parseStats(stdout);
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : round(values.reduce((a, b) => a + b, 0) / values.length, 1);

async function logBytes(container: string): Promise<number> {
  const { stdout, stderr } = await run('docker', ['logs', container], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
}

async function healthy(base: string, timeoutMs = 180000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await get(base, '/api/health')).status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the platform did not become healthy');
    await sleep(100);
  }
}

async function measureLoad(vus: number, duration: string): Promise<LoadMeasure> {
  const out = join(mkdtempSync(join(os.tmpdir(), 'bde-optim-')), 'load.json');
  const samples = { app: [] as Usage[], database: [] as Usage[] };
  let running = true;
  const sampler = (async () => {
    while (running) {
      const [app, database] = await Promise.all([usageOf(APP), usageOf(DATABASE)]);
      samples.app.push(app);
      samples.database.push(database);
    }
  })();
  const before = await logBytes(APP);
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'qa/perf/load.ts',
      '--vus',
      String(vus),
      '--duration',
      duration,
      '--json',
      out,
    ],
    {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  running = false;
  await sampler;
  const after = await logBytes(APP);
  const result = JSON.parse(readFileSync(out, 'utf8')) as {
    totals: { requests: number; perSecond: number; failedRate: number; p95: number };
    pages: { page: string; requests: number; average: number; p95: number }[];
  };
  const summarize = (list: Usage[]) => ({
    peakMemoryMiB: round(Math.max(...list.map((u) => u.memoryMiB)), 1),
    meanCpu: mean(list.map((u) => u.cpu)),
  });
  return {
    vus,
    seconds: Number.parseInt(duration, 10),
    requests: result.totals.requests,
    perSecond: result.totals.perSecond,
    failedRate: result.totals.failedRate,
    p95Ms: result.totals.p95,
    pages: result.pages.map((p) => ({
      page: p.page,
      requests: p.requests,
      averageMs: p.average,
      p95Ms: p.p95,
    })),
    app: summarize(samples.app),
    database: summarize(samples.database),
    logBytes: after - before,
  };
}

async function measureServer(
  base: string,
  withLoad: boolean,
  vus: number,
  duration: string,
): Promise<ServerMeasure> {
  const restarts: number[] = [];
  for (let n = 0; n < 3; n += 1) {
    await run('docker', ['stop', APP]);
    const started = performance.now();
    await run('docker', ['start', APP]);
    await healthy(base);
    restarts.push(performance.now() - started);
  }
  await sleep(20000); // the first minute after a start is not "at rest": the migrations check, the first tick of the reminders
  const idle = { app: [] as Usage[], database: [] as Usage[] };
  for (let n = 0; n < 8; n += 1) {
    idle.app.push(await usageOf(APP));
    idle.database.push(await usageOf(DATABASE));
    await sleep(1000);
  }
  const average = (list: Usage[]): Usage => ({
    cpu: mean(list.map((u) => u.cpu)),
    memoryMiB: mean(list.map((u) => u.memoryMiB)),
  });
  return {
    restartMs: spread(restarts),
    idle: { app: average(idle.app), database: average(idle.database) },
    load: withLoad ? await measureLoad(vus, duration) : null,
  };
}

// -- main ------------------------------------------------------------------------------------------------------------------

async function main() {
  const label = flag('label', 'measure')!;
  const only = new Set((flag('only', 'image,pages,db,scans,server,growth') ?? '').split(','));
  const runs = Number(flag('runs', '15'));
  const base = required('QA_BASE_URL');
  const secret = required('QA_AUTH_SECRET');

  const measurement: Measurement = {
    label,
    takenAt: new Date().toISOString(),
    environment: {
      platform: `${os.type()} ${os.release()}`,
      cpus: os.cpus().length,
      memoryGiB: round(os.totalmem() / 1024 ** 3, 1),
      node: process.version,
    },
    dataset: {},
  };

  if (only.has('image')) measurement.image = await measureImage(flag('image', 'bde-network')!);
  if (only.has('pages')) measurement.pages = await measurePages(base, secret, runs);
  if (only.has('db')) measurement.db = await measureDb(base, secret);
  if (only.has('scans')) measurement.scans = await measureScans(base, secret);
  if (only.has('growth')) {
    measurement.growth = await measureGrowth();
    measurement.dataset = Object.fromEntries(
      measurement.growth.tables.filter((t) => t.rows > 0).map((t) => [t.table, t.rows]),
    );
  }
  // The server last: it restarts the application and loads it.
  if (only.has('server')) {
    measurement.server = await measureServer(
      base,
      flag('load', 'yes') !== 'no',
      Number(flag('vus', '20')),
      flag('duration', '40s')!,
    );
  }

  const out = flag('out');
  if (out) writeFileSync(out, `${JSON.stringify(measurement, null, 2)}\n`);
  const report = markdownOf(measurement);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
