import { appendFileSync, writeFileSync } from 'node:fs';
import { platformFromEnvironment, type Platform } from '../access/http';
import { Report } from './core';
import { checkCsrf } from './csrf';
import { checkFeeds } from './feeds';
import { checkInjection } from './injection';
import { checkIntra } from './intra';
import { checkLimits } from './limits';
import { checkTemplates } from './templates';
import { checkLogs } from './logs';
import { checkUploads } from './uploads';
import { checkHeaders } from './headers';
import { checkSessions } from './sessions';
import { checkSql } from './sql';

/**
 * The attacks: what somebody who is not a member (or is, and wants more) can try against a running platform
 * (`sh qa/platform.sh up`). Each suite is a file of this folder and says, check by check, what it saw.
 *
 *   tsx qa/security/run.ts [--only headers,sessions,csrf,...] [--report report.json]
 *
 * Exit code 1 when a check fails.
 */

export const SUITES: Record<string, (platform: Platform, report: Report) => Promise<void>> = {
  headers: checkHeaders,
  sessions: checkSessions,
  csrf: checkCsrf,
  feeds: checkFeeds,
  uploads: checkUploads,
  injection: checkInjection,
  sql: checkSql,
  templates: checkTemplates,
  intra: checkIntra,
  limits: checkLimits,
  logs: checkLogs,
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

  const path = flag('report');
  if (path) writeFileSync(path, JSON.stringify(report.checks, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Attacks on the platform',
        '',
        '| suite | checks | failed |',
        '|---|---|---|',
        ...report.byArea().map((row) => `| ${row.area} | ${row.total} | ${row.failed} |`),
        '',
        ...(failures ? ['```', failures, '```', ''] : []),
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
