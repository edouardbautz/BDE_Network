// What the unit tests do not cover, file by file, worst first: `npm run test:coverage` then `node scripts/coverage-gaps.mjs`.
// Reads coverage/coverage-final.json (istanbul format, written by the V8 provider). The files are grouped by how much a
// mistake there would cost (the "risk" column), which is what decides the order in which the gaps are closed
// (qa/coverage-plan.md).
//
//   node scripts/coverage-gaps.mjs [--min-uncovered 5] [--json]
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();
const flags = process.argv.slice(2);
const minUncovered = Number(flags[flags.indexOf('--min-uncovered') + 1]) || 5;
const asJson = flags.includes('--json');

/** The areas whose failure is the most expensive, first match wins. */
export const RISKS = [
  [
    'critical',
    /^src\/(lib\/(auth|permissions|roles|settings|setup)|proxy\.ts|app\/api|config)\b|actions\.ts$|^docker\//,
  ],
  [
    'high',
    /^src\/lib\/(events|notifications|members|branding|updates|public-address|audit-log|health)/,
  ],
  ['medium', /^src\/(app|components)\//],
];
export const riskOf = (file) => RISKS.find(([, pattern]) => pattern.test(file))?.[0] ?? 'low';

const raw = JSON.parse(readFileSync(resolve(root, 'coverage/coverage-final.json'), 'utf8'));

const files = Object.entries(raw).map(([path, data]) => {
  const file = relative(root, path).replaceAll('\\', '/');
  const statements = Object.entries(data.s);
  const uncoveredLines = new Set();
  for (const [id, hits] of statements) {
    if (hits === 0) {
      const { start, end } = data.statementMap[id];
      for (let line = start.line; line <= end.line; line += 1) uncoveredLines.add(line);
    }
  }
  const branches = Object.values(data.b).flat();
  const functions = Object.values(data.f);
  const ranges = [];
  for (const line of [...uncoveredLines].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return {
    file,
    risk: riskOf(file),
    statements: statements.length,
    uncovered: statements.filter(([, hits]) => hits === 0).length,
    branches: branches.length,
    uncoveredBranches: branches.filter((hits) => hits === 0).length,
    functions: functions.length,
    uncoveredFunctions: functions.filter((hits) => hits === 0).length,
    ranges: ranges.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)),
  };
});

const percent = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 1000) / 10);
const gaps = files
  .filter((item) => item.uncovered >= minUncovered || item.uncoveredBranches >= minUncovered * 2)
  .sort(
    (a, b) =>
      ['critical', 'high', 'medium', 'low'].indexOf(a.risk) -
        ['critical', 'high', 'medium', 'low'].indexOf(b.risk) || b.uncovered - a.uncovered,
  );

if (asJson) {
  console.log(JSON.stringify(gaps, null, 2));
} else {
  const total = files.reduce((sum, item) => sum + item.statements, 0);
  const missed = files.reduce((sum, item) => sum + item.uncovered, 0);
  console.log(
    `statements: ${percent(total - missed, total)}% (${missed} uncovered of ${total}), files with a gap: ${gaps.length}\n`,
  );
  let current = '';
  for (const item of gaps) {
    if (item.risk !== current) {
      current = item.risk;
      console.log(`\n== ${current} ==`);
    }
    console.log(
      `${String(percent(item.statements - item.uncovered, item.statements)).padStart(5)}%  ${String(item.uncovered).padStart(3)} stmts  ` +
        `${String(item.uncoveredBranches).padStart(3)}/${String(item.branches).padStart(3)} branches  ${item.file}  [${item.ranges.slice(0, 8).join(', ')}${item.ranges.length > 8 ? ', …' : ''}]`,
    );
  }
}
