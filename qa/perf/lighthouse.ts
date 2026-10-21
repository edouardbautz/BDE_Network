import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { cookieHeaderFor, persona, type PersonaKey } from '../personas';
import {
  breaches,
  budgetFor,
  markdownTable,
  numbersOf,
  type Budgets,
  type Lhr,
  type PageResult,
} from './lighthouse-report';

/**
 * Lighthouse on the pages of the platform made by `qa/platform.sh`: the four scores, the speed of what is drawn (LCP, TBT, CLS)
 * and the weight (transferred, scripts, requests), each held to the budget of `budgets.json`. Lighthouse is a pinned version run
 * with `npx`, not a dependency of the project (it brings hundreds of packages the project never ships), and Chrome is the one of
 * Playwright. Signed-in pages carry the forged cookie of a persona.
 *
 *   sh qa/platform.sh up --now 2026-10-16T12:00:00Z && eval "$(sh qa/platform.sh env)" && npx tsx qa/perf/lighthouse.ts [name…]
 *
 * It writes each full report to `lighthouse-reports/` (kept by the job), prints the table, and ends with 1 when a budget is broken.
 */

const LIGHTHOUSE = 'lighthouse@13.5.0';

interface Target {
  name: string;
  who: PersonaKey;
  path: string;
  /** A computer as well as a phone (the phone, with its slow network and processor, is what the budgets are about). */
  desktop?: boolean;
}

const TARGETS: Target[] = [
  { name: 'login', who: 'anonymous', path: '/en', desktop: true },
  { name: 'dashboard', who: 'member', path: '/en/dashboard', desktop: true },
  {
    name: 'calendar',
    who: 'member',
    path: '/en/events?view=calendar&month=2026-10',
    desktop: true,
  },
  { name: 'event', who: 'member', path: '/en/events/qa-fx-series' },
  { name: 'event-form', who: 'proposer', path: '/en/events/new' },
  { name: 'members', who: 'owner', path: '/en/members', desktop: true },
  { name: 'settings', who: 'owner', path: '/en/settings' },
];

/**
 * `npx` is a script on Windows, which only a shell runs, and a shell takes the arguments as one line: the ones with a space, a quote or
 * a character the shell uses (the & of an address) are quoted. (On the CI's Linux nothing is quoted and no shell is used.)
 */
function quoted(argument: string): string {
  return process.platform === 'win32' && /[\s"&|<>^%]/.test(argument)
    ? `"${argument.replace(/"/g, '\\"')}"`
    : argument;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is needed (eval "$(sh qa/platform.sh env)")`);
  return value;
}

async function main() {
  const base = required('QA_BASE_URL');
  const secret = required('QA_AUTH_SECRET');
  const only = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const budgets = JSON.parse(readFileSync(resolve('qa/perf/budgets.json'), 'utf8')) as Budgets;
  const reports = resolve(process.env.LIGHTHOUSE_REPORTS ?? 'lighthouse-reports');
  mkdirSync(reports, { recursive: true });

  const results: PageResult[] = [];
  for (const target of TARGETS.filter(
    (candidate) => only.length === 0 || only.includes(candidate.name),
  )) {
    const cookie = await cookieHeaderFor(persona(target.who), secret);
    for (const formFactor of target.desktop
      ? (['mobile', 'desktop'] as const)
      : (['mobile'] as const)) {
      const file = join(reports, `${target.name}-${formFactor}.json`);
      // The cookie goes in a file of its own (Lighthouse reads one), not on a command line that a shell would take apart.
      const headers = join(reports, `.headers-${target.name}.json`);
      if (cookie) writeFileSync(headers, JSON.stringify({ Cookie: cookie }));
      const run = spawnSync(
        'npx',
        [
          '--yes',
          LIGHTHOUSE,
          `${base}${target.path}`,
          '--output=json',
          `--output-path=${file}`,
          '--quiet',
          '--only-categories=performance,accessibility,best-practices,seo',
          '--chrome-flags=--headless=new --no-sandbox',
          ...(formFactor === 'desktop' ? ['--preset=desktop'] : []),
          ...(cookie ? [`--extra-headers=${headers}`] : []),
        ].map(quoted),
        {
          env: { ...process.env, CHROME_PATH: chromium.executablePath() },
          stdio: ['ignore', 'inherit', 'inherit'],
          shell: process.platform === 'win32',
        },
      );
      rmSync(headers, { force: true });
      if (run.status !== 0)
        throw new Error(
          `Lighthouse failed on ${target.name} (${formFactor}), status ${run.status}`,
        );

      const numbers = numbersOf(JSON.parse(readFileSync(file, 'utf8')) as Lhr);
      results.push({
        page: target.name,
        formFactor,
        numbers,
        breaches: breaches(numbers, budgetFor(budgets, target.name, formFactor)),
      });
    }
  }

  const table = markdownTable(results);
  console.log(table);
  writeFileSync(join(reports, 'summary.md'), table);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
  if (results.some((result) => result.breaches.length > 0)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
