/**
 * The report of Stryker (mutation-report/report.json) as a table by file and the list of the mutations no test noticed, for the
 * summary of the job. Pure (tested in `summary.test.ts`); `qa/mutation/summary-run.ts` reads the file.
 */

export interface MutantReport {
  status: string;
  mutatorName: string;
  replacement?: string;
  location: { start: { line: number } };
}

export interface FileReport {
  source: string;
  mutants: MutantReport[];
}

export interface Report {
  files: Record<string, FileReport>;
}

/** Killed (by a test, or by timing out) count for the score; mutants that no test runs count against it, as Stryker does. */
const KILLED = new Set(['Killed', 'Timeout']);
const COUNTED = new Set(['Killed', 'Timeout', 'Survived', 'NoCoverage']);

export interface FileScore {
  file: string;
  killed: number;
  survived: number;
  uncovered: number;
  score: number;
}

export function scoreOf(report: Report): { files: FileScore[]; total: number } {
  const files = Object.entries(report.files).map(([file, data]) => {
    const counted = data.mutants.filter((mutant) => COUNTED.has(mutant.status));
    const killed = counted.filter((mutant) => KILLED.has(mutant.status)).length;
    return {
      file,
      killed,
      survived: counted.filter((mutant) => mutant.status === 'Survived').length,
      uncovered: counted.filter((mutant) => mutant.status === 'NoCoverage').length,
      score: counted.length === 0 ? 100 : (killed / counted.length) * 100,
    };
  });
  const all = Object.values(report.files).flatMap((data) =>
    data.mutants.filter((mutant) => COUNTED.has(mutant.status)),
  );
  const killedAll = all.filter((mutant) => KILLED.has(mutant.status)).length;
  return { files, total: all.length === 0 ? 100 : (killedAll / all.length) * 100 };
}

/** The mutations no test noticed: where, what was changed. */
export function survivors(report: Report): string[] {
  return Object.entries(report.files).flatMap(([file, data]) => {
    const lines = data.source.split('\n');
    return data.mutants
      .filter((mutant) => mutant.status === 'Survived' || mutant.status === 'NoCoverage')
      .map((mutant) => {
        const line = mutant.location.start.line;
        const code = (lines[line - 1] ?? '').trim().slice(0, 100);
        return `${file}:${line} [${mutant.status}] ${mutant.mutatorName}: ${code} → ${String(mutant.replacement ?? '').slice(0, 60)}`;
      });
  });
}

export function markdown(report: Report): string {
  const { files, total } = scoreOf(report);
  const rows = files.map(
    (file) =>
      `| ${file.file} | ${file.score.toFixed(1)} % | ${file.killed} | ${file.survived} | ${file.uncovered} |`,
  );
  const left = survivors(report);
  return [
    `### Mutation testing: ${total.toFixed(1)} %`,
    '',
    '| file | score | killed | survived | not run by a test |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...(left.length > 0
      ? [
          '<details><summary>The mutations no test noticed</summary>',
          '',
          '```',
          ...left,
          '```',
          '',
          '</details>',
        ]
      : ['No mutation survived.']),
    '',
  ].join('\n');
}
