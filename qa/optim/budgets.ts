import { readFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Measurement } from './types';

/**
 * The budgets that hold what the optimisation campaign gained: numbers a change must not go over, checked on every pull request
 * (the `budgets` job of `ci.yml`: the image, and for every page the statements it sends, the scripts it loads at once and its HTML)
 * and every night (the `measures` workflow, which adds the server: restart, memory, failed requests). Only what does not depend on
 * the machine is judged on a pull request: bytes and statements. The durations are measured, never judged by a single run (see
 * "Which numbers are held tight, and which loose" in docs/architecture.md).
 *
 * A budget is a written number in `budgets.json`. Going over one is a pull request that says why and raises it, with the reason in
 * the description; a page that has no budget fails until it has one (a new page brings its numbers).
 */

export interface PageBudget {
  /** Statements sent to PostgreSQL for one request of the page. */
  statements: number;
  /** Scripts the page loads at once, compressed, in KiB. */
  scriptsKiB: number;
  /** The HTML on the wire, in KiB. */
  htmlKiB: number;
}

export interface ServerBudget {
  /** From `docker start` to a healthy platform, median, ms: loose (a shared runner). */
  restartMs: number;
  /** Memory of the application at rest, MiB. */
  idleAppMiB: number;
  /** Peak memory of the application under the load of 20 people, MiB. */
  peakAppMiB: number;
  /** Share of failed requests under that load. */
  failedRate: number;
}

export interface Budgets {
  /** What the image holds (`du` of its file system): the same on every Docker, unlike the sum of its layers. */
  image: { maxMiB: number };
  pages: Record<string, PageBudget>;
  server: ServerBudget;
}

export interface Breach {
  subject: string;
  what: string;
  limit: number;
  seen: number;
  unit: string;
}

export interface Verdict {
  breaches: Breach[];
  /** How many numbers were compared: a check that compares nothing proves nothing. */
  checked: number;
}

const KIB = 1024;
const round = (value: number) => Math.round(value * 10) / 10;

export function checkBudgets(measurement: Measurement, budgets: Budgets): Verdict {
  const breaches: Breach[] = [];
  let checked = 0;
  const over = (subject: string, what: string, seen: number, limit: number, unit: string) => {
    checked += 1;
    if (seen > limit) breaches.push({ subject, what, limit, seen: round(seen), unit });
  };

  if (measurement.image) {
    const content = measurement.image.contentKiB;
    if (content === undefined) {
      breaches.push({
        subject: 'image',
        what: 'was not measured (its content: du of its file system)',
        limit: 0,
        seen: 0,
        unit: '',
      });
    } else {
      over('image', 'content', content / KIB, budgets.image.maxMiB, 'MiB');
    }
  }

  const statements = new Map(measurement.db?.map((d) => [d.name, d.queries]) ?? []);
  const measured = new Set<string>();
  for (const page of measurement.pages ?? []) {
    measured.add(page.name);
    const budget = budgets.pages[page.name];
    if (!budget) {
      breaches.push({
        subject: page.name,
        what: 'has no budget (a new page brings its numbers: qa/optim/budgets.json)',
        limit: 0,
        seen: 0,
        unit: '',
      });
      continue;
    }
    if (page.status !== 200) {
      breaches.push({
        subject: page.name,
        what: 'status',
        limit: 200,
        seen: page.status,
        unit: '',
      });
    }
    over(page.name, 'scripts loaded at once', page.scripts.bytes / KIB, budget.scriptsKiB, 'KiB');
    over(page.name, 'HTML', page.htmlBytes / KIB, budget.htmlKiB, 'KiB');
    const queries = statements.get(page.name);
    if (queries !== undefined) over(page.name, 'statements', queries, budget.statements, '');
  }
  if (measurement.pages) {
    for (const name of Object.keys(budgets.pages)) {
      if (!measured.has(name)) {
        breaches.push({
          subject: name,
          what: 'has a budget but was not measured (a page that left, or a measure that broke)',
          limit: 0,
          seen: 0,
          unit: '',
        });
      }
    }
  }

  const load = measurement.server?.load;
  if (measurement.server) {
    over(
      'server',
      'restart (median)',
      measurement.server.restartMs.median,
      budgets.server.restartMs,
      'ms',
    );
    over(
      'server',
      'memory at rest',
      measurement.server.idle.app.memoryMiB,
      budgets.server.idleAppMiB,
      'MiB',
    );
  }
  if (load) {
    over(
      'server',
      'peak memory under load',
      load.app.peakMemoryMiB,
      budgets.server.peakAppMiB,
      'MiB',
    );
    over('server', 'failed requests under load', load.failedRate, budgets.server.failedRate, '');
  }
  return { breaches, checked };
}

export const describe = (breach: Breach): string =>
  breach.limit === 0 && breach.seen === 0
    ? `${breach.subject}: ${breach.what}`
    : `${breach.subject}: ${breach.what} is ${breach.seen}${breach.unit ? ` ${breach.unit}` : ''}, the budget is ${breach.limit}${breach.unit ? ` ${breach.unit}` : ''}`;

export function loadBudgets(path = join(__dirname, 'budgets.json')): Budgets {
  return JSON.parse(readFileSync(path, 'utf8')) as Budgets;
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: tsx qa/optim/budgets.ts <measure.json>');
  const measurement = JSON.parse(readFileSync(file, 'utf8')) as Measurement;
  const verdict = checkBudgets(measurement, loadBudgets());
  const lines = verdict.breaches.map(describe);
  console.log(`${verdict.checked} numbers compared with qa/optim/budgets.json`);
  for (const line of lines) console.error(`✗ ${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Budgets',
        '',
        `${verdict.checked} numbers compared with \`qa/optim/budgets.json\`: ${lines.length === 0 ? 'all within their budget.' : `${lines.length} over.`}`,
        '',
        ...lines.map((line) => `- ${line}`),
        '',
      ].join('\n'),
    );
  }
  if (verdict.checked === 0) {
    console.error('✗ nothing was compared');
    process.exitCode = 1;
  }
  if (lines.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('budgets.ts')) main();
