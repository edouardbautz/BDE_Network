import { kib, mib, round } from './stats';
import type { Measurement } from './types';

/** The measures as Markdown tables, and two measures side by side (the "before" and the "after" of the campaign). */

const row = (...cells: (string | number)[]): string => `| ${cells.join(' | ')} |`;
const table = (head: string[], align: ('l' | 'r')[], rows: string[]): string[] => [
  row(...head),
  `| ${align.map((a) => (a === 'r' ? '---:' : '---')).join(' | ')} |`,
  ...rows,
  '',
];

export function markdownOf(m: Measurement): string {
  const out: string[] = [
    `## ${m.label}`,
    '',
    `Measured ${m.takenAt} on ${m.environment.platform}, ${m.environment.cpus} CPUs, ${m.environment.memoryGiB} GiB.${
      Object.keys(m.dataset).length === 0
        ? ''
        : ` Dataset: ${Object.entries(m.dataset)
            .map(([name, count]) => `${name} ${count}`)
            .join(', ')}.`
    }`,
    '',
  ];

  for (const note of m.notes ?? []) out.push(`> ${note}`, '');

  for (const note of m.notes ?? []) out.push(`> ${note}`, '');

  if (m.image) {
    out.push(
      '### Image',
      '',
      `${m.image.name}: ${mib(m.image.bytes)} MiB.`,
      '',
      ...table(
        ['layer', 'MiB'],
        ['l', 'r'],
        m.image.layers
          .filter((layer) => layer.bytes > 1024 * 1024)
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 8)
          .map((layer) => row(`\`${layer.createdBy}\``, mib(layer.bytes))),
      ),
      ...table(
        ['biggest packages', 'MiB'],
        ['l', 'r'],
        m.image.packages.slice(0, 12).map((pkg) => row(pkg.path, round(pkg.kib / 1024, 1))),
      ),
    );
  }

  if (m.pages) {
    out.push(
      '### Pages',
      '',
      ...table(
        [
          'page',
          'first byte ms (median / p95)',
          'total ms (median / p95)',
          'HTML KiB',
          'scripts loaded at once',
          'scripts referenced',
        ],
        ['l', 'r', 'r', 'r', 'r', 'r'],
        m.pages.map((page) =>
          row(
            page.name,
            `${Math.round(page.firstByteMs.median)} / ${Math.round(page.firstByteMs.p95)}`,
            `${Math.round(page.totalMs.median)} / ${Math.round(page.totalMs.p95)}`,
            kib(page.htmlBytes),
            `${page.scripts.count} files, ${kib(page.scripts.bytes)} KiB`,
            `${page.referencedScripts.count} files, ${kib(page.referencedScripts.bytes)} KiB`,
          ),
        ),
      ),
    );
  }

  if (m.db) {
    out.push(
      '### Database, per page',
      '',
      ...table(
        ['page', 'queries', 'controls', 'database ms', 'sent 5 times or more'],
        ['l', 'r', 'r', 'r', 'l'],
        m.db.map((page) =>
          row(
            page.name,
            page.queries,
            page.controls,
            round(page.totalMs, 1),
            page.repeated.length === 0
              ? ''
              : page.repeated.map((r) => `${r.calls} × \`${r.query.slice(0, 70)}\``).join('<br>'),
          ),
        ),
      ),
    );
  }

  if (m.scans) {
    out.push(
      '### Tables read in full (after every page was opened three times)',
      '',
      ...table(
        ['table', 'rows', 'full scans', 'rows read by them', 'index scans'],
        ['l', 'r', 'r', 'r', 'r'],
        m.scans.map((scan) =>
          row(scan.table, scan.rows, scan.seqScans, scan.seqTuplesRead, scan.indexScans),
        ),
      ),
    );
  }

  if (m.server) {
    const s = m.server;
    out.push(
      '### Server',
      '',
      `Restart to healthy: ${Math.round(s.restartMs.median)} ms (median of ${s.restartMs.n}, worst ${Math.round(s.restartMs.max)}).`,
      '',
      `At rest: application ${round(s.idle.app.memoryMiB, 0)} MiB, ${s.idle.app.cpu}% CPU; PostgreSQL ${round(s.idle.database.memoryMiB, 0)} MiB, ${s.idle.database.cpu}% CPU.`,
      '',
    );
    if (s.load) {
      out.push(
        `Under load (${s.load.vus} people, ${s.load.seconds} s): ${s.load.requests} requests (${round(s.load.perSecond, 1)}/s), ${round(s.load.failedRate * 100, 2)}% failed, 95% under ${Math.round(s.load.p95Ms)} ms. Application: ${round(s.load.app.peakMemoryMiB, 0)} MiB at most, ${s.load.app.meanCpu}% CPU on average. PostgreSQL: ${round(s.load.database.peakMemoryMiB, 0)} MiB at most, ${s.load.database.meanCpu}% CPU on average. The application wrote ${kib(s.load.logBytes)} KiB to its log.`,
        '',
      );
    }
  }

  if (m.growth) {
    out.push(
      '### Growth',
      '',
      `Database: ${mib(m.growth.databaseBytes)} MiB.`,
      '',
      ...table(
        ['table', 'rows', 'KiB', 'bytes per row'],
        ['l', 'r', 'r', 'r'],
        m.growth.tables
          .filter((t) => t.rows > 0)
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 12)
          .map((t) => row(t.table, t.rows, kib(t.bytes), Math.round(t.bytes / t.rows))),
      ),
    );
  }
  return out.join('\n');
}

export interface Change {
  section: string;
  name: string;
  metric: string;
  before: number;
  after: number;
  /** Negative when the number went down (for every metric here, down is better). */
  percent: number;
}

const change = (
  section: string,
  name: string,
  metric: string,
  before: number,
  after: number,
): Change => ({
  section,
  name,
  metric,
  before,
  after,
  percent: before === 0 ? (after === 0 ? 0 : 100) : round(((after - before) / before) * 100, 1),
});

/** Every number that both measures hold, side by side. The pages are matched by name. */
export function compare(before: Measurement, after: Measurement): Change[] {
  const changes: Change[] = [];
  if (before.image && after.image) {
    changes.push(
      change(
        'image',
        after.image.name,
        'size MiB',
        mib(before.image.bytes),
        mib(after.image.bytes),
      ),
    );
  }
  for (const page of after.pages ?? []) {
    const was = before.pages?.find((p) => p.name === page.name);
    if (!was) continue;
    changes.push(
      change(
        'pages',
        page.name,
        'first byte ms (median)',
        Math.round(was.firstByteMs.median),
        Math.round(page.firstByteMs.median),
      ),
      change(
        'pages',
        page.name,
        'total ms (median)',
        Math.round(was.totalMs.median),
        Math.round(page.totalMs.median),
      ),
      change('pages', page.name, 'scripts KiB', kib(was.scripts.bytes), kib(page.scripts.bytes)),
    );
  }
  for (const page of after.db ?? []) {
    const was = before.db?.find((p) => p.name === page.name);
    if (!was) continue;
    changes.push(
      change('database', page.name, 'queries', was.queries, page.queries),
      change('database', page.name, 'database ms', round(was.totalMs, 1), round(page.totalMs, 1)),
    );
  }
  if (before.server && after.server) {
    const b = before.server;
    const a = after.server;
    changes.push(
      change(
        'server',
        'restart',
        'ms (median)',
        Math.round(b.restartMs.median),
        Math.round(a.restartMs.median),
      ),
      change(
        'server',
        'application at rest',
        'MiB',
        round(b.idle.app.memoryMiB, 0),
        round(a.idle.app.memoryMiB, 0),
      ),
      change(
        'server',
        'PostgreSQL at rest',
        'MiB',
        round(b.idle.database.memoryMiB, 0),
        round(a.idle.database.memoryMiB, 0),
      ),
    );
    if (b.load && a.load) {
      changes.push(
        change(
          'server',
          'application under load',
          'peak MiB',
          round(b.load.app.peakMemoryMiB, 0),
          round(a.load.app.peakMemoryMiB, 0),
        ),
        change(
          'server',
          'application under load',
          'mean CPU %',
          b.load.app.meanCpu,
          a.load.app.meanCpu,
        ),
        change('server', 'load', 'p95 ms', Math.round(b.load.p95Ms), Math.round(a.load.p95Ms)),
      );
    }
  }
  if (before.growth && after.growth) {
    changes.push(
      change(
        'growth',
        'database',
        'MiB',
        mib(before.growth.databaseBytes),
        mib(after.growth.databaseBytes),
      ),
    );
  }
  return changes;
}

export function markdownOfComparison(changes: readonly Change[]): string {
  return table(
    ['', 'what', 'before', 'after', 'change'],
    ['l', 'l', 'r', 'r', 'r'],
    changes.map((c) =>
      row(
        c.section,
        `${c.name} — ${c.metric}`,
        c.before,
        c.after,
        `${c.percent > 0 ? '+' : ''}${c.percent}%`,
      ),
    ),
  ).join('\n');
}
