// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseDu, parseHistory, parseStats } from './docker';
import { assetsOf } from './html';
import { compare, markdownOf, markdownOfComparison } from './report';
import { summarizeStatements } from './sql';
import { median, percentile, spread } from './stats';
import type { Measurement } from './types';

describe('statistics', () => {
  it('takes the median of an odd and an even count', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('takes the 95th percentile by nearest rank, never between two measures', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile(values, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
  });

  it('refuses an empty list rather than answering 0', () => {
    expect(() => median([])).toThrow();
    expect(() => percentile([], 95)).toThrow();
  });

  it('summarises a series', () => {
    expect(spread([30, 10, 20])).toEqual({ n: 3, median: 20, p95: 30, min: 10, max: 30 });
  });
});

describe('the assets of a page', () => {
  const html = `
    <link rel="stylesheet" href="/_next/static/css/app.css" data-precedence="next"/>
    <link href="/_next/static/css/other.css" rel="stylesheet"/>
    <script src="/_next/static/chunks/main-abc.js" async=""></script>
    <script src="/_next/static/chunks/page-def.js?dpl=1" async=""></script>
    <script src="https://elsewhere.example/analytics.js"></script>
    <script src="/_next/static/chunks/polyfills-xyz.js" noModule=""></script>
    <script>self.__next_f.push([1,"3:[\\"static/chunks/lazy-123.js\\",\\"static/chunks/main-abc.js\\"]"])</script>`;

  it('lists what the tags load at once, only from the platform', () => {
    const assets = assetsOf(html);
    expect(assets.scripts).toEqual([
      '/_next/static/chunks/main-abc.js',
      '/_next/static/chunks/page-def.js?dpl=1',
    ]);
    expect(assets.stylesheets).toEqual([
      '/_next/static/css/app.css',
      '/_next/static/css/other.css',
    ]);
  });

  it('adds the chunks the data of the page names, once', () => {
    const { referenced } = assetsOf(html);
    expect(referenced).toContain('/_next/static/chunks/lazy-123.js');
    expect(referenced.filter((path) => path.endsWith('main-abc.js'))).toHaveLength(1);
    expect(referenced.some((path) => path.includes('polyfills'))).toBe(false);
  });
});

describe('the statements of a page', () => {
  const rows = [
    { query: 'BEGIN', calls: 2, totalMs: 0.1, rows: 0 },
    { query: 'COMMIT', calls: 2, totalMs: 0.1, rows: 0 },
    { query: 'SELECT * FROM "User" WHERE id = $1', calls: 1, totalMs: 0.4, rows: 1 },
    { query: 'SELECT *\n   FROM "Event" WHERE id = $1', calls: 40, totalMs: 6, rows: 40 },
    { query: 'SELECT * FROM pg_stat_statements', calls: 1, totalMs: 1, rows: 100 },
  ];

  it('counts the queries of the page, not the transaction control nor the measure itself', () => {
    const summary = summarizeStatements(rows);
    expect(summary.queries).toBe(41);
    expect(summary.controls).toBe(4);
    expect(summary.totalMs).toBeCloseTo(6.4);
  });

  it('shows a statement sent many times as repeated (what an N+1 looks like)', () => {
    const { repeated } = summarizeStatements(rows);
    expect(repeated).toEqual([{ query: 'SELECT * FROM "Event" WHERE id = $1', calls: 40 }]);
  });

  it('keeps the slowest statements, biggest first', () => {
    const { slowest } = summarizeStatements(rows, { top: 1 });
    expect(slowest).toHaveLength(1);
    expect(slowest[0]?.calls).toBe(40);
  });
});

describe('what docker prints', () => {
  it('reads the layers of the history in bytes', () => {
    const layers = parseHistory(
      '0\t/bin/sh -c #(nop)  CMD ["node"]\n54012345\t/bin/sh -c apk upgrade --no-cache   && apk add postgresql17-client\nnot a layer',
    );
    expect(layers).toEqual([
      { bytes: 0, createdBy: 'CMD ["node"]' },
      { bytes: 54012345, createdBy: 'apk upgrade --no-cache && apk add postgresql17-client' },
    ]);
  });

  it('sorts the folders by size', () => {
    expect(parseDu('120\t/app/a\n9000\t/app/node_modules\n\n40\t/app/b')).toEqual([
      { kib: 9000, path: '/app/node_modules' },
      { kib: 120, path: '/app/a' },
      { kib: 40, path: '/app/b' },
    ]);
  });

  it('reads the CPU and the memory of a container', () => {
    expect(parseStats('0.15%\t214.3MiB / 15.31GiB')).toEqual({ cpu: 0.15, memoryMiB: 214.3 });
    expect(() => parseStats('--\t--')).toThrow();
  });
});

const measurement = (overrides: Partial<Measurement> = {}): Measurement => ({
  label: 'x',
  takenAt: '2026-10-27T00:00:00.000Z',
  environment: { platform: 'Linux', cpus: 2, memoryGiB: 7, node: 'v22' },
  dataset: { User: 311 },
  ...overrides,
});

const page = (name: string, firstByte: number, scriptBytes: number) => ({
  name,
  who: 'member',
  path: `/fr/${name}`,
  status: 200,
  firstByteMs: { n: 15, median: firstByte, p95: firstByte * 2, min: firstByte, max: firstByte * 3 },
  totalMs: { n: 15, median: firstByte * 2, p95: firstByte * 3, min: 1, max: 9 },
  htmlBytes: 20000,
  scripts: { count: 8, bytes: scriptBytes },
  referencedScripts: { count: 12, bytes: scriptBytes * 2 },
  stylesheets: { count: 1, bytes: 9000 },
});

describe('the report', () => {
  it('tells the pages in a table', () => {
    const text = markdownOf(measurement({ pages: [page('dashboard', 50, 300 * 1024)] }));
    expect(text).toContain('| dashboard | 50 / 100 | 100 / 150 |');
    expect(text).toContain('8 files, 300 KiB');
  });

  it('compares the pages two measures have in common, as a change in percent', () => {
    const before = measurement({ pages: [page('dashboard', 100, 400 * 1024), page('gone', 1, 1)] });
    const after = measurement({ pages: [page('dashboard', 50, 300 * 1024), page('new', 1, 1)] });
    const changes = compare(before, after);
    expect(
      changes.filter((change) => change.name === 'dashboard').map((c) => [c.metric, c.percent]),
    ).toEqual([
      ['first byte ms (median)', -50],
      ['total ms (median)', -50],
      ['scripts KiB', -25],
    ]);
    expect(changes.some((change) => change.name === 'gone' || change.name === 'new')).toBe(false);
  });

  it('writes the comparison with its sign', () => {
    const before = measurement({ pages: [page('dashboard', 100, 100 * 1024)] });
    const after = measurement({ pages: [page('dashboard', 150, 100 * 1024)] });
    expect(markdownOfComparison(compare(before, after))).toContain('+50%');
  });
});
