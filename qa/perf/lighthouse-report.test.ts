import { describe, expect, it } from 'vitest';
import {
  breaches,
  budgetFor,
  markdownTable,
  medianRun,
  numbersOf,
  type Lhr,
} from './lighthouse-report';

const lhr: Lhr = {
  categories: {
    performance: { score: 0.884 },
    accessibility: { score: 1 },
    'best-practices': { score: 0.96 },
    seo: { score: 0.9 },
  },
  audits: {
    'largest-contentful-paint': { numericValue: 3800.4 },
    'total-blocking-time': { numericValue: 90 },
    'cumulative-layout-shift': { numericValue: 0.004 },
    'total-byte-weight': { numericValue: 459776 },
    'resource-summary': {
      details: {
        items: [
          { resourceType: 'total', transferSize: 459776 },
          { resourceType: 'script', transferSize: 307200 },
          { resourceType: 'font', transferSize: 53248 },
        ],
      },
    },
    'network-requests': { details: { items: new Array(49).fill({}) } },
  },
};

describe('numbersOf', () => {
  it('reads the scores as whole points and the numbers behind the performance', () => {
    expect(numbersOf(lhr)).toEqual({
      performance: 88,
      accessibility: 100,
      bestPractices: 96,
      seo: 90,
      lcpMs: 3800.4,
      tbtMs: 90,
      cls: 0.004,
      totalKiB: 449,
      scriptKiB: 300,
      requests: 49,
    });
  });

  it('says 0, not NaN, for what a report does not hold', () => {
    const empty = numbersOf({ categories: {}, audits: {} });
    expect(Object.values(empty).every((value) => value === 0)).toBe(true);
  });
});

describe('breaches', () => {
  const numbers = numbersOf(lhr);

  it('is empty when every limit of the budget is respected, or when there is no budget', () => {
    expect(breaches(numbers, {})).toEqual([]);
    expect(
      breaches(numbers, {
        minPerformance: 80,
        minAccessibility: 95,
        maxLcpMs: 4500,
        maxTbtMs: 200,
        maxCls: 0.1,
        maxTotalKiB: 600,
        maxScriptKiB: 400,
        maxRequests: 60,
      }),
    ).toEqual([]);
  });

  it('names each limit that is broken, with the number and the limit', () => {
    const found = breaches(numbers, {
      minPerformance: 90,
      maxLcpMs: 2500,
      maxTotalKiB: 400,
      maxScriptKiB: 300,
    });
    expect(found.map((breach) => breach.what)).toEqual([
      'performance score',
      'largest contentful paint (ms)',
      'transferred (KiB)',
    ]);
    expect(found[0]).toEqual({ what: 'performance score', value: 88, limit: 90 });
  });

  it('holds a limit that is met exactly: the limit itself is allowed', () => {
    expect(breaches(numbers, { minPerformance: 88, maxScriptKiB: 300, maxRequests: 49 })).toEqual(
      [],
    );
  });
});

describe('budgetFor', () => {
  const budgets = {
    defaults: { minAccessibility: 95, maxLcpMs: 4000, maxRequests: 80 },
    desktop: { maxLcpMs: 2000, maxRequests: 60 },
    pages: {
      members: { maxLcpMs: 5000 },
      'login:desktop': { maxLcpMs: 1500 },
      calendar: { maxRequests: 90 },
    },
  };

  it('is the defaults, then what the page says on top', () => {
    expect(budgetFor(budgets, 'dashboard')).toEqual({
      minAccessibility: 95,
      maxLcpMs: 4000,
      maxRequests: 80,
    });
    expect(budgetFor(budgets, 'members')).toEqual({
      minAccessibility: 95,
      maxLcpMs: 5000,
      maxRequests: 80,
    });
  });

  it('is lower on a computer, where the network and the processor are fast', () => {
    expect(budgetFor(budgets, 'dashboard', 'desktop')).toEqual({
      minAccessibility: 95,
      maxLcpMs: 2000,
      maxRequests: 60,
    });
  });

  it('lets a page speak for a form factor, and that is the last word', () => {
    expect(budgetFor(budgets, 'login', 'desktop').maxLcpMs).toBe(1500);
    expect(budgetFor(budgets, 'login', 'mobile').maxLcpMs).toBe(4000);
    // A page that speaks for all form factors speaks over the computer's defaults too.
    expect(budgetFor(budgets, 'calendar', 'desktop').maxRequests).toBe(90);
  });
});

describe('markdownTable', () => {
  it('has a line per page, and says what broke', () => {
    const numbers = numbersOf(lhr);
    const table = markdownTable([
      { page: 'dashboard', formFactor: 'mobile', numbers, breaches: [] },
      {
        page: 'members',
        formFactor: 'mobile',
        numbers,
        breaches: [{ what: 'scripts (KiB)', value: 300, limit: 250 }],
      },
    ]);
    expect(table).toContain(
      '| dashboard (mobile) | 88 / 100 / 96 / 90 | 3800 | 90 | 0.004 | 449 | 300 | 49 | ok |',
    );
    expect(table).toContain('**scripts (KiB): 300 (limit 250)**');
  });
});

describe('medianRun', () => {
  const run = (performance: number, tbtMs: number) => ({
    numbers: { ...numbersOf({ categories: {}, audits: {} }), performance, tbtMs },
  });

  it('is the run of the median performance score, whole', () => {
    const a = run(71, 468);
    const b = run(60, 712);
    const c = run(84, 200);
    // The numbers stay the ones of a run that was: 71 with its own 468 ms, not 71 with the 200 of another.
    expect(medianRun([a, b, c])).toBe(a);
    expect(medianRun([c, b, a])).toBe(a);
  });

  it('is the run itself for one, and the lower middle one for two (the pessimistic of the two)', () => {
    const slow = run(60, 712);
    const fast = run(84, 200);
    expect(medianRun([fast])).toBe(fast);
    expect(medianRun([fast, slow])).toBe(slow);
  });

  it('refuses nothing to judge, rather than judge a page that was not measured', () => {
    expect(() => medianRun([])).toThrow(/no run/);
  });
});
