import { spawnSync } from 'node:child_process';
import type { Platform } from '../access/http';
import { Report } from './core';

/**
 * What the platform wrote in its logs while everything above was done to it (so this suite runs last). Two things: no
 * secret in them (the signing secret, the 42 secret, the database password, every calendar link and cookie met during the
 * run), and no error the attacks should not have caused (a refused request is not one).
 */

/** What an operator must never be asked to scrub from a log. */
const KNOWN_SECRETS: [string, string][] = [
  ['the 42 client secret', 'qa-client-secret'],
  ['the database password', 'qa-password'],
];

/** Lines that say something went wrong in the platform itself. */
const ERROR_LINE =
  /⨯|\[auth\]\[error\]|Unhandled|TypeError|ReferenceError|RangeError|SyntaxError|PrismaClient|ECONNRESET|Invalid Server Actions request|InvalidCallbackUrl/;

/** What the container wrote, both streams (`docker logs` hands the container's stderr back on its own stderr). */
export function readLogs(container: string): string {
  const result = spawnSync('docker', ['logs', container], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return `${result.stdout}
${result.stderr}`;
}

export async function checkLogs(platform: Platform, report: Report): Promise<void> {
  const container = process.env.QA_APP_CONTAINER ?? 'qa-app';
  const logs = readLogs(container);
  report.check(
    'logs',
    'the logs of the platform could be read (the checks below mean something)',
    logs.length > 200,
    `${logs.length} characters`,
  );

  const secrets = new Map<string, string>([
    ...KNOWN_SECRETS,
    ['the signing secret (AUTH_SECRET)', platform.secret],
    ...report.secrets,
  ]);
  for (const [label, value] of secrets) {
    const encoded = encodeURIComponent(value);
    report.check(
      'logs',
      `${label} is not in the logs`,
      !logs.includes(value) && !logs.includes(encoded),
    );
  }
  report.check(
    'logs',
    'no address with a user and a password in the logs',
    !/\w+:\/\/[^\s/:@]+:[^\s/@]+@/.test(logs),
    (/\w+:\/\/[^\s/:@]+:[^\s/@]+@[^\s]*/.exec(logs)?.[0] ?? '').replace(/:[^:@]+@/, ':…@'),
  );
  report.check(
    'logs',
    'no cookie header, no token in the logs',
    !/set-cookie|authjs\.session-token=ey|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(logs),
  );

  const errors = logs.split('\n').filter((line) => ERROR_LINE.test(line));
  report.check(
    'logs',
    'none of the attacks made the platform write an error',
    errors.length === 0,
    `${errors.length} lines${errors[0] ? `, the first: ${errors[0].slice(0, 160)}` : ''}`,
  );
}
