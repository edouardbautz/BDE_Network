import { readFileSync } from 'node:fs';
import { compare, markdownOfComparison } from './report';
import type { Measurement } from './types';

/**
 * Two measures side by side, as a table of changes in percent (down is better for every number in it):
 *
 *   npx tsx qa/optim/compare.ts qa/optim/baselines/2026-10-27-full.json after.json [--only pages,database,server,image,growth]
 *
 * The raw numbers of the starting point are in `qa/optim/baselines/`; a change shows its own gain by taking a measure on the same
 * machine before and after (`measure.ts --out`), because durations only compare with durations taken on the same machine.
 */

const [beforeFile, afterFile, ...rest] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
  console.error('usage: npx tsx qa/optim/compare.ts <before.json> <after.json> [--only a,b]');
  process.exit(2);
}
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Measurement;

const onlyAt = rest.indexOf('--only');
const only = onlyAt >= 0 ? new Set((rest[onlyAt + 1] ?? '').split(',')) : null;

const changes = compare(read(beforeFile), read(afterFile)).filter(
  (change) => only === null || only.has(change.section),
);
console.log(markdownOfComparison(changes));
