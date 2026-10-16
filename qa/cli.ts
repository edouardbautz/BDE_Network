import { Client } from 'pg';
import { buildDataset, type DatasetOptions } from './dataset';
import { checkInvariants, describeViolations } from './invariants';
import { PERSONAS, cookieHeaderFor, persona, type PersonaKey } from './personas';

/**
 * The command line of the quality harness, for the workflows and for a person at a terminal:
 *
 *   tsx qa/cli.ts load  --database <url> [--seed n] [--members n] [--events-per-year n]   write the dataset
 *   tsx qa/cli.ts sql   [--seed n] ...                                                     print it instead
 *   tsx qa/cli.ts check --database <url> [--tz Europe/Paris]                               the invariants (exit 1 on a violation)
 *   tsx qa/cli.ts cookie --persona <key> --secret <AUTH_SECRET>                            the Cookie header of a persona
 *   tsx qa/cli.ts personas                                                                 the personas, as JSON
 */

function options(argv: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name?.startsWith('--') && value !== undefined && !value.startsWith('--')) {
      found.set(name.slice(2), value);
      index += 1;
    }
  }
  return found;
}

const number = (flags: Map<string, string>, name: string): number | undefined => {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a whole number`);
  return parsed;
};

function datasetOptions(flags: Map<string, string>): DatasetOptions {
  const wanted: DatasetOptions = {};
  const seed = number(flags, 'seed');
  const members = number(flags, 'members');
  const eventsPerYear = number(flags, 'events-per-year');
  const schoolYears = number(flags, 'school-years');
  if (seed !== undefined) wanted.seed = seed;
  if (members !== undefined) wanted.members = members;
  if (eventsPerYear !== undefined) wanted.eventsPerYear = eventsPerYear;
  if (schoolYears !== undefined) wanted.schoolYears = schoolYears;
  const timeZone = flags.get('tz');
  if (timeZone) wanted.timeZone = timeZone;
  return wanted;
}

async function withDatabase<T>(
  flags: Map<string, string>,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const connectionString = flags.get('database') ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('--database <url> (or DATABASE_URL) is needed');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = options(rest);

  switch (command) {
    case 'sql': {
      process.stdout.write(buildDataset(datasetOptions(flags)).sql);
      return;
    }
    case 'load': {
      const dataset = buildDataset(datasetOptions(flags));
      await withDatabase(flags, (client) => client.query(dataset.sql));
      console.log(`dataset loaded: ${JSON.stringify(dataset.stats)}`);
      return;
    }
    case 'check': {
      const violations = await withDatabase(flags, (client) =>
        checkInvariants(client, { timeZone: flags.get('tz') ?? 'Europe/Paris' }),
      );
      if (violations.length > 0) {
        console.error(
          `✗ ${violations.length} violation(s) of the invariants of the database:\n${describeViolations(violations)}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log('✓ the invariants of the database hold');
      return;
    }
    case 'cookie': {
      const secret = flags.get('secret') ?? process.env.AUTH_SECRET;
      const key = flags.get('persona');
      if (!secret || !key) throw new Error('--persona <key> and --secret <AUTH_SECRET> are needed');
      const header = await cookieHeaderFor(persona(key as PersonaKey), secret);
      // The visitor with no cookie sends nothing: an empty line.
      process.stdout.write(`${header ?? ''}\n`);
      return;
    }
    case 'personas': {
      process.stdout.write(`${JSON.stringify(PERSONAS, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`unknown command "${command ?? ''}": load, sql, check, cookie or personas`);
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
