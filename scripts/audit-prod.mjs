#!/usr/bin/env node
// Fails when `npm audit` reports a high or critical advisory in the production
// dependency tree that is not listed in scripts/audit-allowlist.json.
//
// Why not a plain `npm audit --omit=dev --audit-level=high`? A few advisories
// have no fix we can apply without a major upgrade of Next.js or Prisma, so that
// command would stay red forever and be ignored. The allow-list records each
// accepted advisory with its reason, so any *new* one still fails the build.
// Run it with `npm run audit:prod` (it relies on npm_execpath, so it works the
// same on Windows, Linux and macOS without going through a shell).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BLOCKING = new Set(['high', 'critical']);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Run this script through npm: npm run audit:prod');
  process.exit(2);
}

const allowlist = JSON.parse(
  readFileSync(new URL('./audit-allowlist.json', import.meta.url), 'utf8'),
);

const result = spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('Could not read the output of `npm audit`:');
  console.error(result.stderr || result.stdout || '(no output)');
  process.exit(2);
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  process.exit(2);
}

// Each advisory appears as an object in `via`; plain strings only name the
// package it came through.
const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via === 'string') continue;
    advisories.set(via.url.split('/').pop(), {
      id: via.url.split('/').pop(),
      severity: via.severity,
      package: via.name,
      title: via.title,
      url: via.url,
    });
  }
}

const allowed = new Set(allowlist.map((entry) => entry.id));
const blocking = [...advisories.values()].filter(
  (advisory) => BLOCKING.has(advisory.severity) && !allowed.has(advisory.id),
);
const accepted = [...advisories.values()].filter(
  (advisory) => BLOCKING.has(advisory.severity) && allowed.has(advisory.id),
);
const stale = allowlist.filter((entry) => !advisories.has(entry.id));

console.log(
  `Production dependencies: ${advisories.size} advisor${advisories.size === 1 ? 'y' : 'ies'}, ` +
    `${accepted.length} high/critical accepted (scripts/audit-allowlist.json).`,
);
for (const entry of stale) {
  console.log(
    `  note: ${entry.id} (${entry.package}) is no longer reported, remove it from the allow-list.`,
  );
}

if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} high/critical advisor${blocking.length === 1 ? 'y' : 'ies'} not accepted:`,
  );
  for (const advisory of blocking) {
    console.error(
      `  [${advisory.severity}] ${advisory.package}: ${advisory.title}\n    ${advisory.url}`,
    );
  }
  console.error(
    '\nUpdate the dependency, or add the advisory to scripts/audit-allowlist.json with a reason.',
  );
  process.exit(1);
}
