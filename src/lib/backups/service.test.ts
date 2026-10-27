// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exec } from './exec';
import type { BackupContext } from './run';
import { backupDir, backupTick, secretsDir } from './service';
import { startBackupScheduler } from './scheduler';
import { runBackup } from './run';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bde-service-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const never: Exec = async () => {
  throw new Error('nothing should run');
};

function context(at: string, exec: Exec = never): BackupContext {
  return {
    dir: join(root, 'backups'),
    secretsDir: join(root, 'secrets'),
    uploadsDir: join(root, 'uploads'),
    databaseUrl: 'postgresql://bde:pw@postgres:5432/bde_network',
    timeZone: 'Europe/Paris',
    version: '1.5.0',
    env: {},
    exec,
    now: () => new Date(at),
  };
}

describe('where the backups are', () => {
  it('is BDE_BACKUP_DIR, else backups/ of the project; the keys are in /secrets unless SECRETS_DIR says', () => {
    expect(backupDir({ BDE_BACKUP_DIR: '/auto-backups' })).toBe('/auto-backups');
    expect(backupDir({ BDE_BACKUP_DIR: '  ' })).toBe(join(process.cwd(), 'backups'));
    expect(secretsDir({})).toBe('/secrets');
    expect(secretsDir({ SECRETS_DIR: '/keys' })).toBe('/keys');
  });
});

describe('one look of the loop', () => {
  it('does nothing before 03:00 of the BDE, and does not even start a tool', async () => {
    const outcome = await backupTick(context('2026-10-27T01:30:00Z'));
    expect(outcome).toEqual({ ran: false, why: 'early' });
  });

  it('makes the backup from 03:00 on (a failure here: the tools are not there, the failure is the answer, not a throw)', async () => {
    const outcome = await backupTick(
      context('2026-10-27T02:05:00Z', async () => ({ code: 1, stdout: '', stderr: 'no pg_dump' })),
    );
    expect(outcome).toMatchObject({ ran: true, result: { ok: false, code: 'dump' } });
  });

  it('waits 30 minutes after a failure, then tries again', async () => {
    const failing: Exec = async () => ({ code: 1, stdout: '', stderr: '' });
    await backupTick(context('2026-10-27T02:05:00Z', failing));
    expect(await backupTick(context('2026-10-27T02:20:00Z'))).toEqual({
      ran: false,
      why: 'retry-later',
    });
    expect(await backupTick(context('2026-10-27T02:40:00Z', failing))).toMatchObject({ ran: true });
  });
});

describe('a folder that cannot be used (the host folder of a rootless Docker, a read-only disk)', () => {
  it('is a failure with its own code, not a crash, and nothing runs', async () => {
    writeFileSync(join(root, 'a-file'), 'x');
    const result = await runBackup(
      { ...context('2026-10-27T02:05:00Z'), dir: join(root, 'a-file', 'backups') },
      'scheduled',
    );
    expect(result).toEqual({ ok: false, code: 'folder' });
  });
});

describe('the scheduler', () => {
  it('does not start outside production, nor without a database address', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    startBackupScheduler();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    startBackupScheduler();
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    log.mockRestore();
    warn.mockRestore();
  });
});
