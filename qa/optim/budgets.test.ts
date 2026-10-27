// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBudgets, describe as describeBreach, loadBudgets, type Budgets } from './budgets';
import { MEASURED_PAGES } from './pages';
import type { Measurement, PageMeasure } from './types';

const spread = (median: number) => ({ n: 3, median, p95: median, min: median, max: median });

const page = (name: string, over: Partial<PageMeasure> = {}): PageMeasure => ({
  name,
  who: 'member',
  path: `/fr/${name}`,
  status: 200,
  firstByteMs: spread(10),
  totalMs: spread(20),
  htmlBytes: 40 * 1024,
  scripts: { count: 8, bytes: 180 * 1024 },
  referencedScripts: { count: 9, bytes: 200 * 1024 },
  stylesheets: { count: 1, bytes: 10 * 1024 },
  ...over,
});

const budgets: Budgets = {
  image: { maxMiB: 260 },
  pages: { dashboard: { statements: 2, scriptsKiB: 185, htmlKiB: 45 } },
  server: { restartMs: 4000, idleAppMiB: 160, peakAppMiB: 600, failedRate: 0 },
};

const measure = (patch: Partial<Measurement> = {}): Measurement => ({
  label: 'test',
  takenAt: '2026-10-27T00:00:00Z',
  environment: { platform: 'linux', cpus: 4, memoryGiB: 16, node: 'v22' },
  dataset: {},
  image: {
    name: 'bde-network',
    bytes: 246 * 1024 * 1024,
    inspectedBytes: 0,
    layers: [],
    folders: [],
    packages: [],
  },
  pages: [page('dashboard')],
  db: [{ name: 'dashboard', queries: 2, controls: 0, totalMs: 1, repeated: [], slowest: [] }],
  ...patch,
});

describe('the budgets', () => {
  it('pass when every number is within its budget, and say how many were compared', () => {
    expect(checkBudgets(measure(), budgets)).toEqual({ breaches: [], checked: 4 });
  });

  it.each([
    [
      'the image',
      { image: { ...measure().image!, bytes: 261 * 1024 * 1024 } },
      'image: size is 261 MiB',
    ],
    [
      'the scripts of a page',
      { pages: [page('dashboard', { scripts: { count: 9, bytes: 190 * 1024 } })] },
      'scripts loaded at once is 190 KiB',
    ],
    [
      'the HTML of a page',
      { pages: [page('dashboard', { htmlBytes: 50 * 1024 })] },
      'HTML is 50 KiB',
    ],
    [
      'the statements of a page (an N+1)',
      {
        db: [
          { name: 'dashboard', queries: 40, controls: 0, totalMs: 9, repeated: [], slowest: [] },
        ],
      },
      'statements is 40, the budget is 2',
    ],
    [
      'a page that does not answer',
      { pages: [page('dashboard', { status: 500 })] },
      'status is 500',
    ],
  ])('fail when %s goes over', (_what, patch, expected) => {
    const { breaches } = checkBudgets(measure(patch), budgets);
    expect(breaches.map(describeBreach).join('\n')).toContain(expected);
  });

  it('fail for a page that has no budget, and for a budget with no page', () => {
    const extra = checkBudgets(measure({ pages: [page('dashboard'), page('backups')] }), budgets);
    expect(extra.breaches.map(describeBreach)).toEqual([
      'backups: has no budget (a new page brings its numbers: qa/optim/budgets.json)',
    ]);
    const missing = checkBudgets(measure({ pages: [] }), budgets);
    expect(missing.breaches.map(describeBreach)).toEqual([
      'dashboard: has a budget but was not measured (a page that left, or a measure that broke)',
    ]);
  });

  it('judge the server only when it was measured: restart, memory at rest, memory under load, failures', () => {
    const server = {
      restartMs: spread(1500),
      idle: { app: { cpu: 0, memoryMiB: 120 }, database: { cpu: 0, memoryMiB: 30 } },
      load: {
        vus: 20,
        seconds: 40,
        requests: 500,
        perSecond: 12,
        failedRate: 0,
        p95Ms: 1300,
        pages: [],
        app: { peakMemoryMiB: 480, meanCpu: 80 },
        database: { peakMemoryMiB: 70, meanCpu: 20 },
        logBytes: 1000,
      },
    };
    expect(checkBudgets(measure({ server }), budgets)).toMatchObject({ breaches: [], checked: 8 });
    const bad = checkBudgets(
      measure({
        server: {
          ...server,
          restartMs: spread(9000),
          load: { ...server.load, failedRate: 0.02, app: { peakMemoryMiB: 900, meanCpu: 80 } },
        },
      }),
      budgets,
    );
    expect(bad.breaches.map((b) => b.what)).toEqual([
      'restart (median)',
      'peak memory under load',
      'failed requests under load',
    ]);
  });
});

describe('qa/optim/budgets.json', () => {
  const written = loadBudgets();

  it('has a budget for every page that is measured, and none for another', () => {
    expect(Object.keys(written.pages).sort()).toEqual(MEASURED_PAGES.map((p) => p.name).sort());
  });

  it('holds what the optimisation campaign gained, not more (the old numbers would pass nothing)', () => {
    // the starting point of the campaign, kept in baselines/: the budgets must be below it where a gain was made
    const before = JSON.parse(
      readFileSync(join(__dirname, 'baselines', '2026-10-27-full.json'), 'utf8'),
    ) as Measurement;
    expect(written.image.maxMiB).toBeLessThan(before.image!.bytes / 1024 / 1024);
    const statements = new Map(before.db!.map((d) => [d.name, d.queries]));
    for (const name of ['dashboard', 'calendar', 'event']) {
      expect(written.pages[name]!.statements).toBeLessThan(statements.get(name)!);
    }
  });
});
