import { writeFileSync } from 'node:fs';
import { CASES } from '../access/actions';
import { contextOf, hostsOf, readManifest } from '../access/actions-run';
import { platformFromEnvironment, withDatabase } from '../access/http';
import { attackSurface } from './sql-args';
import { provenPages } from './sql-targets';

/**
 * What the `sql` suite attacks, written down for the gate of ZAP: for each page of the image, the actions it holds that the suite plays and the
 * names of the fields they are played through (`sql-targets.ts` explains the rule). The gate accepts the SQL injection rule of the scan only
 * there (`"proven": "sql"` in zap-accepted.json), so an alert on a page or a field the suite has not attacked fails the job.
 *
 *   tsx qa/security/sql-proven.ts <out.json>     (the platform up, `sh qa/platform.sh env`)
 *
 * It reads the same two things the suite does and nothing else: the cases of the access matrix (their strings are what is attacked) and the
 * image's own manifest of server actions (the pages that hold each).
 */

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: tsx qa/security/sql-proven.ts <out.json>');
  const manifest = readManifest();
  const platform = platformFromEnvironment();

  const played: Record<string, string[]> = {};
  const hosts: Record<string, string[]> = {};
  await withDatabase(platform, async (db) => {
    const context = await contextOf(db);
    for (const item of CASES) {
      const names = attackSurface(item, context).leaves.map((leaf) => leaf.name);
      if (names.length === 0) continue;
      played[item.action] = [...new Set([...(played[item.action] ?? []), ...names])];
      hosts[item.action] = hostsOf(manifest, item.action);
    }
  });

  const proven = provenPages(hosts, played);
  writeFileSync(out, `${JSON.stringify(proven, null, 2)}\n`);
  console.log(
    `${Object.keys(played).length} actions attacked, ${proven.pages.length} pages with something proven (${out})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
