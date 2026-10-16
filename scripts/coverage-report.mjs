// The coverage of the tests against the floors of coverage-thresholds.json, as a Markdown table (for the summary of
// a CI job) and, with `--check`, as an exit code. `npm run test:coverage` already fails below a floor (Vitest
// enforces them); this says by how much each area clears it, and which floors have room to be raised: a floor that is
// far below the measure protects nothing.
//
//   node scripts/coverage-report.mjs [--check]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const METRICS = ['statements', 'branches', 'functions', 'lines'];
/** A floor this many points under the measure is a floor that could be higher. */
export const ROOM = 2.5;

const toPattern = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);

/** { statements, branches, functions, lines } in percent, for the files whose path matches `matches`. */
export function measure(summary, root, matches) {
  const total = Object.fromEntries(METRICS.map((metric) => [metric, [0, 0]]));
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total') continue;
    const file = key.replaceAll('\\', '/').replace(`${root.replaceAll('\\', '/')}/`, '');
    if (!matches(file)) continue;
    for (const metric of METRICS) {
      total[metric][0] += value[metric].covered;
      total[metric][1] += value[metric].total;
    }
  }
  return Object.fromEntries(
    METRICS.map((metric) => [metric, total[metric][1] === 0 ? 100 : Math.round((total[metric][0] / total[metric][1]) * 1000) / 10]),
  );
}

/** One row per area (the whole project first): what is measured, the floor, and whether it clears it. */
export function buildRows(summary, thresholds, root) {
  const rows = [{ name: 'everything', measured: summary.total ? Object.fromEntries(METRICS.map((m) => [m, summary.total[m].pct])) : null, floor: thresholds.global }];
  for (const [glob, floor] of Object.entries(thresholds.areas)) {
    const pattern = toPattern(glob);
    rows.push({ name: glob.replace(/\/\*\*$/, ''), measured: measure(summary, root, (file) => pattern.test(file)), floor });
  }
  return rows.map((row) => ({
    ...row,
    below: METRICS.filter((metric) => row.measured && row.measured[metric] < row.floor[metric]),
    room: METRICS.filter((metric) => row.measured && row.measured[metric] - row.floor[metric] >= ROOM),
  }));
}

export function toMarkdown(rows) {
  const cell = (row, metric) => {
    const measured = row.measured?.[metric];
    const mark = row.below.includes(metric) ? ' ❌' : row.room.includes(metric) ? ' ⬆️' : '';
    return `${measured ?? '?'} / ${row.floor[metric]}${mark}`;
  };
  return [
    '### Test coverage (measured / floor, in %)',
    '',
    '| area | statements | branches | functions | lines |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.name} | ${METRICS.map((metric) => cell(row, metric)).join(' | ')} |`),
    '',
    '❌ below its floor. ⬆️ the floor is at least 2.5 points under the measure: raise it in `coverage-thresholds.json`.',
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('coverage-report.mjs')) {
  const root = process.cwd();
  const summary = JSON.parse(readFileSync(resolve(root, 'coverage/coverage-summary.json'), 'utf8'));
  const thresholds = JSON.parse(readFileSync(resolve(root, 'coverage-thresholds.json'), 'utf8'));
  const rows = buildRows(summary, thresholds, root);
  process.stdout.write(toMarkdown(rows));
  if (process.argv.includes('--check') && rows.some((row) => row.below.length > 0)) process.exitCode = 1;
}
