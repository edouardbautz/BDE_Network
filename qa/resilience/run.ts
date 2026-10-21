import { appendFileSync, writeFileSync } from 'node:fs';
import { platformFromEnvironment, type Platform } from '../access/http';
import { tableCell } from '../markdown';
import { Report } from '../security/core';
import { checkApp } from './app';
import { checkDatabase } from './database';
import { checkWebhook } from './webhook';

/**
 * Resilience: what happens to the platform when what it stands on goes away (the database, the container, the channel the
 * notifications go to). On a running platform made by `sh qa/platform.sh up`; the `webhook` suite needs the platform made with
 * `--webhook https://qa-hang:8443/hook`. Each suite leaves the platform healthy, so they can follow each other.
 *
 *   tsx qa/resilience/run.ts [--only database,app,webhook] [--report report.json]
 *
 * Exit code 1 when a check fails. These suites stop and kill containers: run them on a platform made for them, never on one
 * that is used for something else.
 */

export const SUITES: Record<string, (platform: Platform, report: Report) => Promise<void>> = {
  database: checkDatabase,
  app: checkApp,
  webhook: checkWebhook,
};

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

async function main() {
  const platform = platformFromEnvironment();
  const wanted = flag('only')?.split(',') ?? Object.keys(SUITES);
  const report = new Report();

  for (const name of wanted) {
    const suite = SUITES[name];
    if (!suite) throw new Error(`no suite ${name}: ${Object.keys(SUITES).join(', ')}`);
    const started = Date.now();
    await suite(platform, report);
    console.log(
      `${name}: ${report.checks.filter((check) => check.area === name).length} checks in ${Math.round((Date.now() - started) / 1000)} s`,
    );
  }

  const failures = report.describeFailures();
  if (failures) console.error(failures);
  console.log(
    `${report.checks.length - report.failures.length} of ${report.checks.length} checks as expected`,
  );
  for (const check of report.checks)
    console.log(`${check.ok ? '✓' : '✗'} [${check.area}] ${check.name}: ${check.detail}`);

  const path = flag('report');
  if (path) writeFileSync(path, JSON.stringify(report.checks, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Resilience of the platform',
        '',
        '| suite | checks | failed |',
        '|---|---|---|',
        ...report.byArea().map((row) => `| ${row.area} | ${row.total} | ${row.failed} |`),
        '',
        '<details><summary>Every check</summary>',
        '',
        '| | check | seen |',
        '|---|---|---|',
        ...report.checks.map(
          (check) =>
            `| ${check.ok ? '✅' : '❌'} | [${check.area}] ${tableCell(check.name)} | ${tableCell(check.detail)} |`,
        ),
        '',
        '</details>',
        '',
      ].join('\n'),
    );
  }
  if (report.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
