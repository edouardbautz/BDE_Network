/**
 * The statements one page sends to PostgreSQL, from `pg_stat_statements` (reset before the page, read after). The extension
 * groups the same statement with different values under one text, so a statement called many times for one page is what an
 * N+1 looks like.
 */

export interface StatementRow {
  query: string;
  calls: number;
  /** `total_exec_time`, in milliseconds. */
  totalMs: number;
  rows: number;
}

export interface StatementSummary {
  /** The statements that read or write data. */
  queries: number;
  /** BEGIN, COMMIT, SET…: counted apart, they are not a query of the page. */
  controls: number;
  totalMs: number;
  /** A statement sent `repeatedFrom` times or more for one page. */
  repeated: { query: string; calls: number }[];
  slowest: { query: string; calls: number; totalMs: number }[];
}

const CONTROL =
  /^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|SAVEPOINT|RELEASE|SET|RESET|SHOW|DEALLOCATE|DISCARD)\b/i;
const OWN = /pg_stat_statements|pg_stat_reset|pg_stat_user_tables/i;

/** One line, bounded: what is told of a statement (it never carries a value, the extension replaced them). */
export const tell = (query: string, max = 160): string => {
  const line = query.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export function summarizeStatements(
  rows: readonly StatementRow[],
  { repeatedFrom = 5, top = 3 }: { repeatedFrom?: number; top?: number } = {},
): StatementSummary {
  const kept = rows.filter((row) => !OWN.test(row.query));
  const queries = kept.filter((row) => !CONTROL.test(row.query));
  return {
    queries: queries.reduce((sum, row) => sum + row.calls, 0),
    controls: kept
      .filter((row) => CONTROL.test(row.query))
      .reduce((sum, row) => sum + row.calls, 0),
    totalMs: queries.reduce((sum, row) => sum + row.totalMs, 0),
    repeated: queries
      .filter((row) => row.calls >= repeatedFrom)
      .sort((a, b) => b.calls - a.calls)
      .map((row) => ({ query: tell(row.query), calls: row.calls })),
    slowest: [...queries]
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, top)
      .map((row) => ({ query: tell(row.query), calls: row.calls, totalMs: row.totalMs })),
  };
}
