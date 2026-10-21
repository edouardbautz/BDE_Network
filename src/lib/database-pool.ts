import type { PoolConfig } from 'pg';

/** How long a connection to the database may take to open: a database that is not there must fail in seconds. */
export const CONNECT_TIMEOUT_MS = 3_000;

/**
 * How long a query may take before the application gives up on it. A database that accepts connections and answers nothing
 * (a stalled disk, a paused virtual machine) would otherwise hold every page for as long as it stays frozen, and no
 * connection timeout sees it: found by the resilience suite of the quality campaign (`qa/resilience`). Far above any query
 * the application makes; the page that gives up shows the
 * error page, and the next one works once the database is back.
 */
export const QUERY_TIMEOUT_MS = 15_000;

export function databasePoolConfig(connectionString: string | undefined): PoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  };
}
