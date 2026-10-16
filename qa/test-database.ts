import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * A real PostgreSQL for the suites that need one: a new empty database with every migration applied, thrown away
 * afterwards. It needs a server, so a suite runs only when `MIGRATION_TEST_DATABASE_URL` is set (the CI's
 * `migrations` job sets it, like for the tests of the data migrations).
 */
export const ADMIN_URL = process.env.MIGRATION_TEST_DATABASE_URL;

const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');

export interface TestDatabase {
  client: Client;
  /** The address of this database, for what has to connect by itself. */
  url: string;
  drop(): Promise<void>;
}

export async function createMigratedDatabase(): Promise<TestDatabase> {
  if (!ADMIN_URL) throw new Error('MIGRATION_TEST_DATABASE_URL is not set');
  const name = `qa_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const address = new URL(ADMIN_URL);
  address.pathname = `/${name}`;
  const client = new Client({ connectionString: address.toString() });
  await client.connect();
  for (const migration of readdirSync(MIGRATIONS)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort()) {
    await client.query(readFileSync(join(MIGRATIONS, migration, 'migration.sql'), 'utf8'));
  }

  return {
    client,
    url: address.toString(),
    drop: async () => {
      await client.end().catch(() => undefined);
      const again = new Client({ connectionString: ADMIN_URL });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    },
  };
}
