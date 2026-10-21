import { describe, expect, it } from 'vitest';
import {
  markdownReport,
  mebibytesUsed,
  memoryVerdict,
  pagesOf,
  totalsOf,
  type K6Summary,
} from './report';

/** What `k6 --summary-export` writes, in the flat form of the version pinned, and the older one with `values`. */
const flat: K6Summary = {
  metrics: {
    http_reqs: { count: 400, rate: 12.5 },
    http_req_failed: { value: 0.01, passes: 4, fails: 396 },
    checks: { value: 0.99, passes: 792, fails: 8 },
    http_req_duration: { avg: 70, 'p(95)': 130, max: 400 },
    'http_req_duration{page:dashboard}': { avg: 40, 'p(95)': 90, max: 150 },
    'http_req_duration{page:members}': { avg: 120, 'p(95)': 3200, max: 3500 },
    'http_reqs{page:dashboard}': { count: 300, rate: 9 },
    'http_reqs{page:members}': { count: 12, rate: 0.4 },
    'http_req_duration{expected_response:true}': { avg: 1, 'p(95)': 1, max: 1 },
  },
};
const old: K6Summary = {
  metrics: {
    http_reqs: { values: { count: 10, rate: 2 } },
    'http_req_duration{page:login}': { values: { avg: 12, 'p(95)': 20, max: 30 } },
    'http_reqs{page:login}': { values: { count: 10 } },
  },
};

describe('pagesOf', () => {
  it('reads the pages of the summary, slowest first, and says which ones broke their limit', () => {
    const pages = pagesOf(flat, { dashboard: 1500, members: 3000 });
    expect(pages.map((page) => page.page)).toEqual(['members', 'dashboard']);
    expect(pages[0]).toMatchObject({ requests: 12, p95: 3200, limit: 3000, slow: true });
    expect(pages[1]).toMatchObject({ requests: 300, p95: 90, limit: 1500, slow: false });
  });

  it('leaves out the metrics that are not a page, and a page with no limit is never slow', () => {
    const pages = pagesOf(flat);
    expect(pages.map((page) => page.page)).not.toContain('true');
    expect(pages.every((page) => page.limit === null && !page.slow)).toBe(true);
  });

  it('reads the older format, where the values are under `values`', () => {
    expect(pagesOf(old, { login: 1000 })).toEqual([
      { page: 'login', requests: 10, average: 12, p95: 20, max: 30, limit: 1000, slow: false },
    ]);
  });
});

describe('totalsOf', () => {
  it('gives the requests, the speed, the failures and the checks that were right', () => {
    expect(totalsOf(flat)).toEqual({
      requests: 400,
      perSecond: 12.5,
      failedRate: 0.01,
      checksRate: 0.99,
      p95: 130,
    });
  });
});

describe('mebibytesUsed', () => {
  it.each([
    ['214.3MiB / 15.31GiB', 214.3],
    ['1.5GiB / 15.31GiB', 1536],
    ['512KiB / 15GiB', 0.5],
    ['  96MiB / 2GiB', 96],
  ])('reads %s', (usage, expected) => {
    expect(mebibytesUsed(usage)).toBeCloseTo(expected, 5);
  });

  it('refuses what it cannot read, rather than say 0', () => {
    expect(() => mebibytesUsed('-- / --')).toThrow(/cannot read/);
  });
});

describe('memoryVerdict', () => {
  it('is fine under the limit, and not at it or over it', () => {
    expect(memoryVerdict(130, 700, 1024).ok).toBe(true);
    expect(memoryVerdict(130, 1024, 1024).ok).toBe(false);
    expect(memoryVerdict(130, 1500, 1024).ok).toBe(false);
  });
});

describe('markdownReport', () => {
  it('is a table with a line per page, and names what is too slow and too big', () => {
    const report = markdownReport(
      pagesOf(flat, { dashboard: 1500, members: 3000 }),
      totalsOf(flat),
      memoryVerdict(130, 1500, 1024),
    );
    expect(report).toContain('| page | requests |');
    expect(report).toContain('| members | 12 | 120 | 3200 | 3500 | 3000 | **too slow** |');
    expect(report).toContain('| dashboard | 300 | 40 | 90 | 150 | 1500 | ok |');
    expect(report).toContain('1.00 % failed');
    expect(report).toContain('**too much**');
  });
});
