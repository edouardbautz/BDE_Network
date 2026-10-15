// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BACKUPS_TO_KEEP,
  STACK_VERSION,
  backupDate,
  backupFileName,
  checkStack,
  connectionEnv,
  newestBackup,
  parseMigrationRows,
  planMigrations,
  selectBackupsToDelete,
} from './safe-update.mjs';

const row = (name: string, finished = true, rolledBack = false) => ({ name, finished, rolledBack });
const M1 = '20260804215820_init';
const M2 = '20261005120000_add_events';
const M3 = '20261015120000_event_series_scope';

describe('checkStack', () => {
  it('says nothing when the compose file and the image belong together, or when nothing says', () => {
    expect(checkStack({ BDE_STACK: String(STACK_VERSION) })).toBeNull();
    expect(checkStack({})).toBeNull(); // a plain `docker run`: the CI, a test
    expect(checkStack({ BDE_STACK: '' })).toBeNull();
  });

  it('tells a compose file older than the image from an image older than the compose file', () => {
    expect(checkStack({ BDE_STACK: String(STACK_VERSION - 1) })).toEqual({
      kind: 'stack-old-compose',
    });
    expect(checkStack({ BDE_STACK: String(STACK_VERSION + 1) })).toEqual({
      kind: 'stack-old-image',
    });
  });

  it('treats a value that is not a number as a compose file the image does not understand', () => {
    expect(checkStack({ BDE_STACK: 'two' })).toEqual({ kind: 'stack-old-image' });
  });
});

describe('connectionEnv', () => {
  it('turns the address of the bundled database into libpq variables, decoding what was encoded', () => {
    expect(
      connectionEnv('postgresql://bde:p%40ss%2Fw%3Ard@postgres:5432/bde_network?schema=public'),
    ).toEqual({
      PGHOST: 'postgres',
      PGPORT: '5432',
      PGUSER: 'bde',
      PGPASSWORD: 'p@ss/w:rd',
      PGDATABASE: 'bde_network',
    });
  });

  it('defaults the port, and accepts both schemes', () => {
    expect(connectionEnv('postgres://u:p@db/x')?.PGPORT).toBe('5432');
    expect(connectionEnv('postgresql://u:p@db:6543/x')?.PGPORT).toBe('6543');
  });

  it('is null for an address that cannot be used: empty, not PostgreSQL, no host, no database', () => {
    for (const bad of [
      '',
      'not an address',
      'mysql://u:p@db/x',
      'postgresql://u:p@/x',
      'postgresql://u:p@db',
    ]) {
      expect(connectionEnv(bad)).toBeNull();
    }
  });
});

describe('parseMigrationRows', () => {
  it('reads the rows psql prints, and ignores anything else', () => {
    const output = `${M1}|t|f\n${M2}|f|f\nnot a row\n\n${M3}|t|t\n`;
    expect(parseMigrationRows(output)).toEqual([
      { name: M1, finished: true, rolledBack: false },
      { name: M2, finished: false, rolledBack: false },
      { name: M3, finished: true, rolledBack: true },
    ]);
  });
});

describe('planMigrations', () => {
  const known = [M1, M2, M3];

  it('a database with nothing applied is a new installation: nothing to protect', () => {
    expect(planMigrations({ applied: [], known })).toMatchObject({
      state: 'fresh',
      pending: known,
    });
  });

  it('is current when everything this image knows is applied', () => {
    expect(planMigrations({ applied: known.map((name) => row(name)), known })).toEqual({
      state: 'current',
      pending: [],
      unknown: [],
      failed: [],
    });
  });

  it('is pending when this image has migrations the database has not: the copy is made then', () => {
    expect(planMigrations({ applied: [row(M1), row(M2)], known })).toMatchObject({
      state: 'pending',
      pending: [M3],
    });
  });

  it('is newer when the database holds migrations this image does not have (an older image on a newer database)', () => {
    const future = '20270101000000_something_new';
    expect(
      planMigrations({ applied: [row(M1), row(M2), row(M3), row(future)], known }),
    ).toMatchObject({
      state: 'newer',
      unknown: [future],
    });
  });

  it('is stuck when a migration failed and was neither finished nor rolled back (Prisma refuses to go on)', () => {
    expect(planMigrations({ applied: [row(M1), row(M2, false, false)], known })).toMatchObject({
      state: 'stuck',
      failed: [M2],
    });
  });

  it('a migration that was rolled back (resolved by hand) is not stuck, it is pending again', () => {
    expect(planMigrations({ applied: [row(M1), row(M2, false, true)], known })).toMatchObject({
      state: 'pending',
      pending: [M2, M3],
    });
  });

  it('keeps off the page anything that does not look like a migration name', () => {
    const plan = planMigrations({ applied: [row(M1), row('<script>alert(1)</script>')], known });
    expect(plan.state).toBe('newer');
    expect(plan.unknown).toEqual([]);
  });

  it('lists at most five names', () => {
    const many = Array.from({ length: 9 }, (_, i) => `2026100${i}000000_m${i}`);
    expect(planMigrations({ applied: [row(M1)], known: [M1, ...many] }).pending).toHaveLength(5);
  });
});

describe('the copies made before an update', () => {
  const at = (iso: string) => new Date(iso);

  it('names a copy after the instant and the version, and reads the instant back', () => {
    const name = backupFileName(at('2026-10-15T10:15:30.123Z'), '1.1.0');
    expect(name).toBe('pre-update_20261015T101530Z_v1.1.0.sql.gz');
    expect(backupDate(name)).toEqual(at('2026-10-15T10:15:30Z'));
  });

  it('writes nothing odd in a name, whatever the version says', () => {
    expect(backupFileName(at('2026-10-15T10:15:30Z'), '../../etc/passwd')).toBe(
      'pre-update_20261015T101530Z_v....etcpasswd.sql.gz',
    );
    expect(backupFileName(at('2026-10-15T10:15:30Z'), '')).toMatch(/_vunknown\.sql\.gz$/);
    expect(backupDate('pre-update_20261015T101530Z_v../x.sql.gz')).toBeNull();
  });

  describe('retention', () => {
    const name = (day: number) =>
      backupFileName(at(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`), '1.0.0');
    const now = at('2026-10-31T00:00:00Z');

    it('keeps the newest five and deletes the rest', () => {
      const names = [1, 2, 3, 4, 5, 6, 7].map(name);
      expect(selectBackupsToDelete(names, { now })).toEqual([name(2), name(1)]);
      expect(BACKUPS_TO_KEEP).toBe(5);
    });

    it('deletes what is older than 90 days, but never the newest copy, whatever its age', () => {
      const old = backupFileName(at('2026-01-01T00:00:00Z'), '1.0.0');
      const older = backupFileName(at('2025-12-01T00:00:00Z'), '1.0.0');
      expect(selectBackupsToDelete([old, older], { now })).toEqual([older]);
      expect(selectBackupsToDelete([old], { now })).toEqual([]);
    });

    it('never touches a file that is not one of ours', () => {
      const names = ['notes.txt', 'bde-backup-2026.tar.gz', ...[1, 2, 3, 4, 5, 6].map(name)];
      expect(selectBackupsToDelete(names, { now })).toEqual([name(1)]);
    });

    it('finds the newest', () => {
      expect(newestBackup([name(2), 'x', name(9), name(4)])).toBe(name(9));
      expect(newestBackup(['x'])).toBeNull();
    });
  });
});
