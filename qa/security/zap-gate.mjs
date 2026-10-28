// The verdict on a ZAP report (qa/security/zap.sh): every alert is listed, and one of a level that is not accepted fails.
//
//   node qa/security/zap-gate.mjs <zap.json> [--accepted qa/security/zap-accepted.json]
//
// An alert is accepted by its ZAP plugin id and the path it was found on (a regular expression, `.*` for any), with the
// reason: nothing is accepted without one, and an accepted alert that no longer shows up is reported so that it is removed.
//
// An entry with `"proven": "sql"` is accepted only where the `sql` suite of qa/security has attacked what the alert is about: the page must hold an
// action that was attacked, and the field the alert altered be one of the fields it was attacked through (`--proven <file>`, made by
// qa/security/sql-proven.ts from the image and the cases of the access matrix). An alert anywhere else is not accepted, whatever the path says.
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
          param: instance.param ?? '',
        });
      }
    }
  }
  return rows;
}

/**
 * Is a finding on this page and this field one the `sql` suite attacked? The page must be one that holds an action that was attacked, and the field one of
 * the fields those actions were attacked through, or an internal field of a server action (`$ACTION_REF_1`, `$ACTION_ID_…`: React adds them to every form,
 * and they carry no text of anybody's).
 */
/** @param {{ pages: { pattern: string; fields: string[] }[] } | undefined} proven */
export function isProven(proven, path, param) {
  return (proven?.pages ?? []).some(
    (page) =>
      new RegExp(page.pattern).test(path) &&
      (String(param).startsWith('$ACTION_') || page.fields.includes(param)),
  );
}

/**
 * `{ failing, accepted, unused }`: what is not accepted, what is, and the accepted entries that matched nothing.
 * @param {{ pages: { pattern: string; fields: string[] }[] }} [proven] what the `sql` suite attacked (see `isProven`)
 */
export function judge(rows, accepted, proven = { pages: [] }) {
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
      (entry) =>
        entry.plugin === row.plugin &&
        new RegExp(`^(?:${entry.path})$`).test(path) &&
        (!entry.proven || isProven(proven, path, row.param)),
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
  const provenOption = args.indexOf('--proven');
  const provenPath = provenOption === -1 ? null : args[provenOption + 1];
  const acceptedPath =
    option === -1
      ? fileURLToPath(new URL('./zap-accepted.json', import.meta.url))
      : args[option + 1];
  const file = args.find(
    (argument, index) =>
      !argument.startsWith('--') &&
      (option === -1 || index !== option + 1) &&
      (provenOption === -1 || index !== provenOption + 1),
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

  if (accepted.some((entry) => entry.proven) && !(provenPath && existsSync(provenPath))) {
    console.error(
      'an accepted alert is accepted only where it is proven ("proven"): the gate needs --proven <file> (qa/security/sql-proven.ts)',
    );
    process.exit(1);
  }
  const proven = provenPath ? JSON.parse(readFileSync(provenPath, 'utf8')) : { pages: [] };

  const rows = findings(JSON.parse(readFileSync(file, 'utf8')));
  const { failing, accepted: kept, unused } = judge(rows, accepted, proven);

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
    console.error(
      `✗ ${names[row.risk]} [${row.plugin}] ${row.name} — ${row.uri}${row.param ? ` (${row.param})` : ''}`,
    );
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
