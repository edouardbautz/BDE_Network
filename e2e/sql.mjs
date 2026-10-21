import { execFileSync } from 'node:child_process';

/**
 * Runs SQL statements with the `psql` command the workflow gives in `PSQL` ("psql -h 127.0.0.1 -U bde -d bde_install"), and
 * returns what it prints. The command is split into the program and its arguments and started WITHOUT a shell: what the
 * environment holds is never taken for a line of shell (so the words are separated by spaces, with no quoting). The password
 * is `PGPASSWORD`, in the environment.
 */
export function sqlRunner(psql) {
  const [program, ...args] = psql.trim().split(/\s+/);
  if (!program)
    throw new Error('PSQL is empty: give the psql command, e.g. "psql -h 127.0.0.1 -U bde -d bde"');
  return (statements) =>
    execFileSync(program, [...args, '-v', 'ON_ERROR_STOP=1', '-q', '-tA'], { input: statements })
      .toString()
      .trim();
}
