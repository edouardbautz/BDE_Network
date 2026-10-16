// Fails when a SARIF report (what CodeQL writes) holds a finding that must stop a pull request: a result of level
// `error`, or of `security-severity` 7.0 or more (high and critical). CodeQL uploads its alerts to the Security tab
// either way; this is what makes them stop a merge instead of waiting there to be read.
//
//   node scripts/sarif-gate.mjs <folder with .sarif files>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The results of a SARIF document that stop a merge, with where they are. */
export function blockingResults(sarif) {
  const found = [];
  for (const run of sarif.runs ?? []) {
    const rules = new Map();
    for (const rule of run.tool?.driver?.rules ?? []) rules.set(rule.id, rule);
    for (const result of run.results ?? []) {
      const rule = rules.get(result.ruleId);
      const severity = Number(
        rule?.properties?.['security-severity'] ?? result.properties?.['security-severity'] ?? 0,
      );
      const level = result.level ?? rule?.defaultConfiguration?.level ?? 'warning';
      if (level !== 'error' && severity < 7) continue;
      const location = result.locations?.[0]?.physicalLocation;
      found.push({
        rule: result.ruleId,
        level,
        severity,
        message: result.message?.text ?? '',
        file: location?.artifactLocation?.uri ?? '?',
        line: location?.region?.startLine ?? 0,
      });
    }
  }
  return found;
}

export function readFolder(folder) {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.sarif'))
    .flatMap((name) => blockingResults(JSON.parse(readFileSync(join(folder, name), 'utf8'))));
}

if (process.argv[1]?.endsWith('sarif-gate.mjs')) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('usage: node scripts/sarif-gate.mjs <folder>');
    process.exit(2);
  }
  const found = readFolder(folder);
  for (const item of found) {
    console.error(
      `✗ ${item.rule} (${item.level}, severity ${item.severity}) ${item.file}:${item.line}\n  ${item.message}`,
    );
  }
  console.log(found.length === 0 ? '✓ no blocking finding' : `${found.length} blocking finding(s)`);
  process.exitCode = found.length === 0 ? 0 : 1;
}
