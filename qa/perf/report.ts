/**
 * The pure parts of the load report (`load.ts`): what k6 wrote, and what the container used, turned into the lines a person
 * reads, and into the verdicts that are not k6's own (the memory).
 */

/** What `k6 --summary-export` writes for a metric: its values flat, or under `values` (the format changed between versions). */
export interface K6Metric {
  values?: Record<string, number>;
  [key: string]: unknown;
}
export interface K6Summary {
  metrics: Record<string, K6Metric>;
}

const valuesOf = (metric: K6Metric | undefined): Record<string, number> => {
  if (!metric) return {};
  if (metric.values) return metric.values;
  return Object.fromEntries(
    Object.entries(metric).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
};

export interface PageNumbers {
  page: string;
  requests: number;
  average: number;
  p95: number;
  max: number;
  /** The limit set for 95 % of the requests, when the summary says it. */
  limit: number | null;
  slow: boolean;
}

/** The pages of the summary (the metrics tagged `page`), slowest first. */
export function pagesOf(summary: K6Summary, limits: Record<string, number> = {}): PageNumbers[] {
  const pages: PageNumbers[] = [];
  for (const [name, metric] of Object.entries(summary.metrics)) {
    const match = /^http_req_duration\{page:([\w-]+)\}$/.exec(name);
    if (!match) continue;
    const page = match[1]!;
    const values = valuesOf(metric);
    const requests = valuesOf(summary.metrics[`http_reqs{page:${page}}`]).count ?? 0;
    const limit = limits[page] ?? null;
    pages.push({
      page,
      requests,
      average: values.avg ?? 0,
      p95: values['p(95)'] ?? 0,
      max: values.max ?? 0,
      limit,
      slow: limit !== null && (values['p(95)'] ?? 0) >= limit,
    });
  }
  return pages.sort((a, b) => b.p95 - a.p95);
}

/** The whole run, in numbers: how many requests, how fast, how many failed, how many checks were right. */
export function totalsOf(summary: K6Summary) {
  const requests = valuesOf(summary.metrics.http_reqs);
  const failed = valuesOf(summary.metrics.http_req_failed);
  const checks = valuesOf(summary.metrics.checks);
  const duration = valuesOf(summary.metrics.http_req_duration);
  return {
    requests: requests.count ?? 0,
    perSecond: requests.rate ?? 0,
    failedRate: failed.rate ?? failed.value ?? 0,
    checksRate: checks.rate ?? checks.value ?? 0,
    p95: duration['p(95)'] ?? 0,
  };
}

/** `"214.3MiB / 15.31GiB"` (what `docker stats` prints) → mebibytes used. */
export function mebibytesUsed(usage: string): number {
  const match = /^\s*([\d.]+)\s*([KMG]i?B)\b/i.exec(usage);
  if (!match) throw new Error(`cannot read a memory usage from "${usage}"`);
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit.startsWith('k')) return amount / 1024;
  if (unit.startsWith('g')) return amount * 1024;
  return amount;
}

export interface MemoryVerdict {
  before: number;
  after: number;
  /** What the application may hold after the load, in mebibytes. */
  limit: number;
  ok: boolean;
}

/** The memory of the application after the load: under the limit, which is what a small server has to spare. */
export function memoryVerdict(before: number, after: number, limit: number): MemoryVerdict {
  return { before, after, limit, ok: after < limit };
}

/** The report, as the Markdown table of the summary of a job. */
export function markdownReport(
  pages: PageNumbers[],
  totals: ReturnType<typeof totalsOf>,
  memory: MemoryVerdict,
): string {
  const rows = pages.map(
    (page) =>
      `| ${page.page} | ${page.requests} | ${Math.round(page.average)} | ${Math.round(page.p95)} | ${Math.round(page.max)} | ${
        page.limit === null ? '' : page.limit
      } | ${page.slow ? '**too slow**' : 'ok'} |`,
  );
  return [
    '### Load',
    '',
    `${totals.requests} requests (${totals.perSecond.toFixed(1)} per second), ${(totals.failedRate * 100).toFixed(2)} % failed, ${(
      totals.checksRate * 100
    ).toFixed(2)} % of the checks right, 95 % of the answers under ${Math.round(totals.p95)} ms.`,
    '',
    '| page | requests | average ms | p95 ms | max ms | limit (p95) ms | |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
    `Memory of the application: ${Math.round(memory.before)} MiB before, ${Math.round(memory.after)} MiB after (limit ${memory.limit} MiB): ${
      memory.ok ? 'ok' : '**too much**'
    }.`,
    '',
  ].join('\n');
}
