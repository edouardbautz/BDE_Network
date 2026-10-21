import { describe, expect, it } from 'vitest';
import { CONNECT_TIMEOUT_MS, databasePoolConfig, QUERY_TIMEOUT_MS } from './database-pool';

describe('databasePoolConfig', () => {
  const config = databasePoolConfig('postgresql://user:pass@host:5432/db');

  it('keeps the address it is given', () => {
    expect(config.connectionString).toBe('postgresql://user:pass@host:5432/db');
  });

  it('gives up on a database that does not answer a connection, in seconds', () => {
    expect(config.connectionTimeoutMillis).toBe(CONNECT_TIMEOUT_MS);
    expect(CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('gives up on a query that is never answered, before a visitor gives up on the page', () => {
    expect(config.query_timeout).toBe(QUERY_TIMEOUT_MS);
    expect(QUERY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(QUERY_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});
