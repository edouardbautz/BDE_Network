/**
 * The pure parts of the Lighthouse check (`lighthouse.ts`): what a report says of a page, the budgets a page is held to, and
 * the verdict. A budget is a number written down; a page that goes over it is a failure with the number, and a budget is
 * raised in a pull request that says why.
 */

/** The parts of a Lighthouse report (`lhr`) that are read here. */
export interface Lhr {
  categories: Record<string, { score: number | null }>;
  audits: Record<
    string,
    {
      numericValue?: number;
      details?: { items?: { resourceType?: string; transferSize?: number }[] };
    }
  >;
}

export interface PageNumbers {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  lcpMs: number;
  tbtMs: number;
  cls: number;
  totalKiB: number;
  scriptKiB: number;
  requests: number;
}

const kib = (bytes: number | undefined) => (bytes ?? 0) / 1024;
const score = (lhr: Lhr, id: string) => Math.round((lhr.categories[id]?.score ?? 0) * 100);

/** What matters of a report: the four scores and the numbers behind the performance. */
export function numbersOf(lhr: Lhr): PageNumbers {
  const items = lhr.audits['resource-summary']?.details?.items ?? [];
  return {
    performance: score(lhr, 'performance'),
    accessibility: score(lhr, 'accessibility'),
    bestPractices: score(lhr, 'best-practices'),
    seo: score(lhr, 'seo'),
    lcpMs: lhr.audits['largest-contentful-paint']?.numericValue ?? 0,
    tbtMs: lhr.audits['total-blocking-time']?.numericValue ?? 0,
    cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? 0,
    totalKiB: kib(lhr.audits['total-byte-weight']?.numericValue),
    scriptKiB: kib(items.find((item) => item.resourceType === 'script')?.transferSize),
    requests: lhr.audits['network-requests']?.details?.items?.length ?? 0,
  };
}

/**
 * The run that stands for several: the one with the median performance score, whole (the numbers of one run belong together:
 * the median of each number taken apart would describe a page that never was). Lighthouse on a shared runner moves from one
 * run to the next (the blocking time of the members page was 468 ms, then 712), and the median of three is what its own
 * continuous-integration tool takes.
 */
export function medianRun<T extends { numbers: PageNumbers }>(runs: T[]): T {
  if (runs.length === 0) throw new Error('no run to take the median of');
  const sorted = [...runs].sort((a, b) => a.numbers.performance - b.numbers.performance);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** What a page may not go over (or under). Every key is optional: a page is held to what its budget says. */
export interface Budget {
  minPerformance?: number;
  minAccessibility?: number;
  minBestPractices?: number;
  minSeo?: number;
  maxLcpMs?: number;
  maxTbtMs?: number;
  maxCls?: number;
  maxTotalKiB?: number;
  maxScriptKiB?: number;
  maxRequests?: number;
}

export interface Breach {
  what: string;
  value: number;
  limit: number;
}

/** Which limits of `budget` the numbers break. */
export function breaches(numbers: PageNumbers, budget: Budget): Breach[] {
  const found: Breach[] = [];
  const atLeast = (what: string, value: number, limit: number | undefined) => {
    if (limit !== undefined && value < limit) found.push({ what, value, limit });
  };
  const atMost = (what: string, value: number, limit: number | undefined) => {
    if (limit !== undefined && value > limit) found.push({ what, value, limit });
  };
  atLeast('performance score', numbers.performance, budget.minPerformance);
  atLeast('accessibility score', numbers.accessibility, budget.minAccessibility);
  atLeast('best-practices score', numbers.bestPractices, budget.minBestPractices);
  atLeast('SEO score', numbers.seo, budget.minSeo);
  atMost('largest contentful paint (ms)', numbers.lcpMs, budget.maxLcpMs);
  atMost('total blocking time (ms)', numbers.tbtMs, budget.maxTbtMs);
  atMost('cumulative layout shift', numbers.cls, budget.maxCls);
  atMost('transferred (KiB)', numbers.totalKiB, budget.maxTotalKiB);
  atMost('scripts (KiB)', numbers.scriptKiB, budget.maxScriptKiB);
  atMost('requests', numbers.requests, budget.maxRequests);
  return found;
}

export interface Budgets {
  /** What every page is held to, on a phone. */
  defaults: Budget;
  /** What changes on a computer (a fast network and processor: the limits are much lower). */
  desktop?: Budget;
  /** What a page says of its own, by name (`members`), or by name and form factor (`members:desktop`). */
  pages?: Record<string, Budget>;
  /** Why a page has the budget it has, when it is not the defaults': read by people, not by the check. */
  notes?: Record<string, string>;
}

/** The budget of a page: the defaults, then those of the form factor, then what the page says (for all, then for that form factor). */
export function budgetFor(
  budgets: Budgets,
  page: string,
  formFactor: 'mobile' | 'desktop' = 'mobile',
): Budget {
  return {
    ...budgets.defaults,
    ...(formFactor === 'desktop' ? (budgets.desktop ?? {}) : {}),
    ...(budgets.pages?.[page] ?? {}),
    ...(budgets.pages?.[`${page}:${formFactor}`] ?? {}),
  };
}

export interface PageResult {
  page: string;
  formFactor: string;
  numbers: PageNumbers;
  breaches: Breach[];
}

/** The results, as the Markdown table of the summary of a job. */
export function markdownTable(results: PageResult[]): string {
  const rows = results.map(({ page, formFactor, numbers: n, breaches: broken }) =>
    [
      `${page} (${formFactor})`,
      `${n.performance} / ${n.accessibility} / ${n.bestPractices} / ${n.seo}`,
      Math.round(n.lcpMs),
      Math.round(n.tbtMs),
      n.cls.toFixed(3),
      Math.round(n.totalKiB),
      Math.round(n.scriptKiB),
      n.requests,
      broken.length === 0
        ? 'ok'
        : `**${broken.map((b) => `${b.what}: ${Number(b.value.toFixed(3))} (limit ${b.limit})`).join('; ')}**`,
    ].join(' | '),
  );
  return [
    '### Lighthouse',
    '',
    'The median run of several for each page (the one with the median performance score).',
    '',
    '| page | performance / accessibility / best practices / SEO | LCP ms | TBT ms | CLS | KiB | script KiB | requests | |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}
