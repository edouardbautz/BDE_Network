// The verdict on a ZAP report (qa/security/zap.sh): every alert is listed, and one of a level that is not accepted fails.
//
//   node qa/security/zap-gate.mjs <zap.json> [--accepted qa/security/zap-accepted.json]
//
// An alert is accepted by its ZAP plugin id and the path it was found on (a regular expression, `.*` for any), with the
// reason: nothing is accepted without one, and an accepted alert that no longer shows up is reported so that it is removed.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** ZAP's `riskcode`: 0 informational, 1 low, 2 medium, 3 high. Medium and above is a failure unless accepted. */
export const FAILING_RISK = 2;

/** What the report says, one row per alert and instance: `{ plugin, name, risk, uri }`. */
export function findings(report) {
  const rows = [];
  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      for (const instance of alert.instances ?? [{ uri: '' }]) {
        rows.push({
          plugin: String(alert.pluginid),
          name: alert.name,
          risk: Number(alert.riskcode),
          uri: instance.uri ?? '',
        });
      }
    }
  }
  return rows;
}

/** `{ failing, accepted, unused }`: what is not accepted, what is, and the accepted entries that matched nothing. */
export function judge(rows, accepted) {
  const used = new Set();
  const failing = [];
  const kept = [];
  for (const row of rows) {
    const path = (() => {
      try {
        return new URL(row.uri).pathname;
      } catch {
        return row.uri;
      }
    })();
    const index = accepted.findIndex(
      (entry) => entry.plugin === row.plugin && new RegExp(`^(?:${entry.path})$`).test(path),
    );
    if (index !== -1) {
      used.add(index);
      kept.push(row);
    } else if (row.risk >= FAILING_RISK) failing.push(row);
  }
  return {
    failing,
    accepted: kept,
    unused: accepted.filter((_, index) => !used.has(index)),
  };
}

function main() {
  const args = process.argv.slice(2);
  const option = args.indexOf('--accepted');
  const acceptedPath =
    option === -1
      ? fileURLToPath(new URL('./zap-accepted.json', import.meta.url))
      : args[option + 1];
  const file = args.find(
    (argument, index) => !argument.startsWith('--') && (option === -1 || index !== option + 1),
  );
  if (!file || !existsSync(file)) {
    console.error(`no ZAP report at ${file}`);
    process.exit(1);
  }
  const accepted = existsSync(acceptedPath) ? JSON.parse(readFileSync(acceptedPath, 'utf8')) : [];
  for (const entry of accepted) {
    if (!entry.plugin || !entry.path || !entry.reason) {
      console.error(
        `an accepted alert needs a plugin, a path and a reason: ${JSON.stringify(entry)}`,
      );
      process.exit(1);
    }
  }

  const rows = findings(JSON.parse(readFileSync(file, 'utf8')));
  const { failing, accepted: kept, unused } = judge(rows, accepted);

  const names = ['informational', 'low', 'medium', 'high'];
  const byAlert = new Map();
  for (const row of rows) {
    const key = `${row.risk}|${row.name}`;
    byAlert.set(key, (byAlert.get(key) ?? 0) + 1);
  }
  const lines = [...byAlert]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, count]) => {
      const [risk, name] = key.split('|');
      return `${names[Number(risk)]?.padEnd(13)} ${String(count).padStart(4)}  ${name}`;
    });
  console.log(lines.join('\n') || 'no alert');
  console.log(
    `\n${rows.length} alerts, ${kept.length} accepted, ${failing.length} not accepted at medium or above`,
  );
  for (const row of failing.slice(0, 40))
    console.error(`✗ ${names[row.risk]} [${row.plugin}] ${row.name} — ${row.uri}`);
  for (const entry of unused)
    console.error(`! accepted but not seen any more, to remove: [${entry.plugin}] ${entry.path}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### ZAP',
        '',
        '```',
        ...lines,
        '```',
        '',
        `${rows.length} alerts, ${failing.length} not accepted.`,
        '',
      ].join('\n'),
    );
  }
  if (failing.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
