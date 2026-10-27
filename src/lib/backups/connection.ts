/**
 * The variables `pg_dump` and `psql` read to reach the database, made from the address the application uses. That address is Prisma's
 * (`?schema=public` is its own parameter and `libpq` refuses it), and the password must not travel on a command line, where any
 * process of the machine could read it: the tools get `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` instead.
 */
export interface Connection {
  env: Record<string, string>;
  database: string;
}

export function connectionOf(databaseUrl: string): Connection {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('the address of the database cannot be read');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('the address of the database is not a PostgreSQL one');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('the address of the database names no database');
  const env: Record<string, string> = {
    PGHOST: url.hostname || 'localhost',
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: database,
    // A short wait: a database that is down must not hold the backup for the minutes the tools would give it
    PGCONNECT_TIMEOUT: '10',
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  return { env, database };
}

/** The same connection, to another database of the same server (the maintenance database, or the scratch one). */
export function toDatabase(connection: Connection, database: string): Connection {
  return { env: { ...connection.env, PGDATABASE: database }, database };
}
