// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM, buildRows, measure, toMarkdown } from './coverage-report.mjs';

const file = (covered: number, total: number) => ({
  statements: { covered, total, pct: 0 },
  branches: { covered, total, pct: 0 },
  functions: { covered, total, pct: 0 },
  lines: { covered, total, pct: 0 },
});
const SUMMARY = {
  total: { statements: { pct: 90 }, branches: { pct: 80 }, functions: { pct: 85 }, lines: { pct: 91 } },
  '/repo/src/lib/auth/a.ts': file(9, 10),
  '/repo/src/lib/auth/b.ts': file(1, 10),
  '/repo/src/lib/roles/c.ts': file(10, 10),
  '/repo/src/components/d.tsx': file(0, 10),
};
const FLOOR = { statements: 50, branches: 50, functions: 50, lines: 50 };

describe('measure', () => {
  it('adds up the files of an area, not the average of their percentages', () => {
    const auth = measure(SUMMARY, '/repo', (path) => path.startsWith('src/lib/auth/'));
    // (9 + 1) / (10 + 10), not (90 + 10) / 2 of two files of different sizes
    expect(auth.statements).toBe(50);
  });

  it('reads Windows paths, and counts an area with no file as covered (nothing to miss)', () => {
    const win = { 'C:\\repo\\src\\lib\\auth\\a.ts': file(5, 10) };
    expect(measure(win, 'C:\\repo', (path) => path.startsWith('src/lib/auth/')).statements).toBe(50);
    expect(measure(SUMMARY, '/repo', () => false).statements).toBe(100);
  });
});

describe('buildRows', () => {
  const rows = buildRows(SUMMARY, { global: FLOOR, areas: { 'src/lib/auth/**': { ...FLOOR, statements: 60 }, 'src/lib/roles/**': FLOOR } }, '/repo');

  it('has the whole project first, then every area', () => {
    expect(rows.map((row) => row.name)).toEqual(['everything', 'src/lib/auth', 'src/lib/roles']);
  });

  it('says which metrics are below their floor, and which floors have room', () => {
    const auth = rows.find((row) => row.name === 'src/lib/auth');
    expect(auth?.below).toEqual(['statements', 'branches', 'functions', 'lines'].filter((m) => m === 'statements'));
    const roles = rows.find((row) => row.name === 'src/lib/roles');
    expect(roles?.below).toEqual([]);
    // 100 against a floor of 50: far more than the room allowed
    expect(roles?.room).toHaveLength(4);
    expect(ROOM).toBeGreaterThan(0);
  });

  it('does not match a path that only starts like the area', () => {
    const only = buildRows({ '/repo/src/lib/authority/x.ts': file(0, 10) }, { global: FLOOR, areas: { 'src/lib/auth/**': FLOOR } }, '/repo');
    // the file is not in `src/lib/auth/`: the area has nothing, so nothing is below
    expect(only[1]?.below).toEqual([]);
  });
});

describe('toMarkdown', () => {
  it('makes a table, marks what is below and what has room', () => {
    const text = toMarkdown(buildRows(SUMMARY, { global: FLOOR, areas: { 'src/lib/auth/**': { ...FLOOR, statements: 60 }, 'src/lib/roles/**': FLOOR } }, '/repo'));
    expect(text).toContain('| src/lib/auth | 50 / 60 ❌ |');
    expect(text).toContain('| src/lib/roles | 100 / 50 ⬆️ |');
    expect(text.split('\n').filter((line) => line.startsWith('|')).length).toBe(2 + 3);
  });
});

describe('coverage-thresholds.json', () => {
  const thresholds = JSON.parse(readFileSync('coverage-thresholds.json', 'utf8')) as {
    global: Record<string, number>;
    areas: Record<string, Record<string, number>>;
  };

  it('gives every area a floor for each of the four metrics, between 0 and 100', () => {
    for (const floor of [thresholds.global, ...Object.values(thresholds.areas)]) {
      expect(Object.keys(floor).sort()).toEqual(['branches', 'functions', 'lines', 'statements']);
      for (const value of Object.values(floor)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('names areas that exist: a renamed folder must not leave a floor that protects nothing', () => {
    for (const glob of Object.keys(thresholds.areas)) {
      expect(glob.endsWith('/**'), glob).toBe(true);
      expect(existsSync(glob.slice(0, -3)), glob).toBe(true);
    }
  });

  it('keeps the floor of an area at or above the global floor for the areas that guard access and data', () => {
    for (const glob of ['src/lib/auth/**', 'src/lib/permissions/**', 'src/lib/roles/**', 'src/lib/settings/**']) {
      const floor = thresholds.areas[glob];
      expect(floor?.statements, glob).toBeGreaterThanOrEqual(thresholds.global.statements ?? 0);
    }
  });
});
