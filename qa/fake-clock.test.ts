// @vitest-environment node
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * The clock of a QA platform (`qa/fake-clock.cjs`): the application sees the moment of the dataset, at the normal speed, and
 * nothing else of `Date` changes. It is loaded into a node process of its own, like the container does.
 */

const run = promisify(execFile);
const clock = join(process.cwd(), 'qa', 'fake-clock.cjs');

async function inProcess(script: string, moment?: string): Promise<unknown> {
  const { stdout } = await run(process.execPath, ['--require', clock, '--eval', script], {
    env: { ...process.env, BDE_QA_NOW: moment ?? '' },
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}

const MOMENT = '2026-10-16T12:00:00Z';
const BASE = Date.parse(MOMENT);

describe('the clock of a QA platform', () => {
  it('starts at the moment it is given, for the three ways to ask', async () => {
    const seen = (await inProcess(
      'console.log(JSON.stringify({ now: Date.now(), made: new Date().getTime(), text: Date() }))',
      MOMENT,
    )) as { now: number; made: number; text: string };

    expect(seen.now - BASE).toBeGreaterThanOrEqual(0);
    expect(seen.now - BASE).toBeLessThan(10_000);
    expect(seen.made - BASE).toBeLessThan(10_000);
    // `Date()` is the text of that moment (the day is the 16th in every time zone of the world but a few).
    expect(seen.text).toContain('2026');
    expect(seen.text).toMatch(/Oct 1[56]/);
  });

  it('runs at the normal speed from there', async () => {
    const elapsed = (await inProcess(
      `const a = Date.now();
       setTimeout(() => console.log(JSON.stringify(Date.now() - a)), 200);`,
      MOMENT,
    )) as number;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('leaves a date that is built from arguments, and what a date is, alone', async () => {
    const seen = (await inProcess(
      `const fixed = new Date('2020-02-29T10:00:00Z'); const pieces = new Date(2021, 0, 2, 3, 4, 5);
       console.log(JSON.stringify({
         fixed: fixed.toISOString(), epoch: new Date(0).getTime(), pieces: pieces.getFullYear(),
         utc: Date.UTC(2000, 0, 1), parsed: Date.parse('2001-01-01T00:00:00Z'),
         isDate: new Date() instanceof Date && fixed instanceof Date, tag: Object.prototype.toString.call(new Date()),
         json: new Date(86400000).toJSON(),
       }))`,
      MOMENT,
    )) as Record<string, unknown>;

    expect(seen).toMatchObject({
      fixed: '2020-02-29T10:00:00.000Z',
      epoch: 0,
      pieces: 2021,
      utc: 946684800000,
      parsed: 978307200000,
      isDate: true,
      tag: '[object Date]',
      json: '1970-01-02T00:00:00.000Z',
    });
  });

  it('does nothing without a moment: the clock of the machine', async () => {
    const seen = (await inProcess('console.log(JSON.stringify({ now: Date.now() }))')) as {
      now: number;
    };
    expect(Math.abs(seen.now - Date.now())).toBeLessThan(10_000);
  });

  it('refuses a moment that is not a date, rather than run at a wrong time', async () => {
    await expect(inProcess('console.log("{}")', 'next tuesday')).rejects.toThrow(
      /BDE_QA_NOW is not a date/,
    );
  });
});
