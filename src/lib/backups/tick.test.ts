// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exec } from './exec';
import type { BackupSituation } from './notifications/facts';
import type { BackupNotification } from './notifications/send';
import type { BackupContext } from './run';
import { readStatus, writeStatus, type BackupStatus } from './status';
import { backupTick, forgetVolatileState } from './tick';

/**
 * When the owners are told: the first failure of the day (a failure each time would be one message every 30 minutes), and no backup
 * for two days (once a day for as long as it lasts). Written in the status file before the message is sent; held in memory when the
 * folder is the problem.
 */

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bde-tick-'));
  dir = join(root, 'backups');
  forgetVolatileState();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const failing: Exec = async () => ({ code: 1, stdout: '', stderr: 'no' });

function context(at: string, over: Partial<BackupContext> = {}): BackupContext {
  return {
    dir,
    secretsDir: join(root, 'secrets'),
    uploadsDir: join(root, 'uploads'),
    databaseUrl: 'postgresql://bde:pw@postgres:5432/bde_network',
    timeZone: 'Europe/Paris',
    version: '1.5.0',
    env: {},
    exec: failing,
    now: () => new Date(at),
    ...over,
  };
}

const status = (partial: Partial<BackupStatus>): BackupStatus => ({
  version: 1,
  since: '2026-10-01T00:00:00Z',
  attempts: [],
  alerts: {},
  ...partial,
});

function recorder() {
  const told: { type: BackupNotification; situation: BackupSituation }[] = [];
  const notify = vi.fn(async (type: BackupNotification, situation: BackupSituation) => {
    told.push({ type, situation });
  });
  return { told, notify };
}

describe('a backup that fails', () => {
  it('tells the owners at the first failure of the day, with the reason, and not again for the retries', async () => {
    const { told, notify } = recorder();
    await backupTick(context('2026-10-27T02:05:00Z'), notify); // 03:05 in Paris: due, fails
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ type: 'backupFailed', situation: { reasonCode: 'dump' } });

    expect(await backupTick(context('2026-10-27T02:20:00Z'), notify)).toEqual({
      ran: false,
      why: 'retry-later',
    });
    await backupTick(context('2026-10-27T02:40:00Z'), notify); // the retry fails too
    await backupTick(context('2026-10-27T03:15:00Z'), notify); // and the third
    expect(told).toHaveLength(1);
    expect((await readStatus(dir, new Date())).alerts.failed).toBe('2026-10-27');
  });

  it('tells them again the next day', async () => {
    const { told, notify } = recorder();
    await backupTick(context('2026-10-27T02:05:00Z'), notify);
    await backupTick(context('2026-10-28T02:05:00Z'), notify);
    expect(told.map((entry) => entry.type)).toEqual(['backupFailed', 'backupFailed']);
  });

  it('says how long it has been since the last good backup, and how big it was', async () => {
    await writeStatus(
      dir,
      status({
        attempts: [
          { at: '2026-10-25T02:00:00Z', ok: true, kind: 'scheduled', name: 'x', bytes: 4242 },
        ],
      }),
    );
    const { told, notify } = recorder();
    await backupTick(context('2026-10-27T02:05:00Z'), notify);
    expect(told[0]?.situation).toMatchObject({
      lastAt: new Date('2026-10-25T02:00:00Z'),
      lastBytes: 4242,
      days: 2,
    });
  });

  it('does not tell anybody that another backup was running', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.lock'), '{}');
    utimesSync(
      join(dir, '.lock'),
      new Date('2026-10-27T02:00:00Z'),
      new Date('2026-10-27T02:00:00Z'),
    );
    const { told, notify } = recorder();
    expect(await backupTick(context('2026-10-27T02:05:00Z'), notify)).toEqual({
      ran: true,
      result: { ok: false, code: 'busy' },
    });
    expect(told).toHaveLength(0);
  });

  it('goes on when the message cannot be sent', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notify = vi.fn(async () => {
      throw new Error('smtp down');
    });
    expect(await backupTick(context('2026-10-27T02:05:00Z'), notify)).toMatchObject({ ran: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect((await readStatus(dir, new Date())).alerts.failed).toBe('2026-10-27');
    error.mockRestore();
  });
});

describe('no backup for two days', () => {
  const old = status({
    attempts: [{ at: '2026-10-24T02:00:00Z', ok: true, kind: 'scheduled', name: 'x', bytes: 10 }],
  });

  it('tells the owners once a day for as long as it lasts, early in the morning too (before the backup is due)', async () => {
    await writeStatus(dir, old);
    const { told, notify } = recorder();
    await backupTick(context('2026-10-27T00:30:00Z'), notify); // 01:30 in Paris: early, but three days without
    await backupTick(context('2026-10-27T00:35:00Z'), notify);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ type: 'backupStale', situation: { days: 2 } });
    await backupTick(context('2026-10-28T00:30:00Z'), notify);
    expect(told.filter((entry) => entry.type === 'backupStale')).toHaveLength(2);
  });

  it('is not said at 47 hours', async () => {
    await writeStatus(dir, old);
    const { told, notify } = recorder();
    await backupTick(context('2026-10-26T01:00:00Z'), notify);
    expect(told).toHaveLength(0);
  });

  it('counts from the first look when there never was a backup', async () => {
    await writeStatus(dir, status({ since: '2026-10-25T00:00:00Z' }));
    const { told, notify } = recorder();
    await backupTick(context('2026-10-26T23:00:00Z'), notify);
    expect(told).toHaveLength(0);
    await backupTick(context('2026-10-27T00:30:00Z'), notify);
    expect(told.map((entry) => entry.type)).toEqual(['backupStale']);
    expect(told[0]?.situation.lastAt).toBeNull();
  });

  it('says it with the reason of the last failure when there is one', async () => {
    await writeStatus(
      dir,
      status({
        attempts: [
          { at: '2026-10-24T02:00:00Z', ok: true, kind: 'scheduled', name: 'x' },
          { at: '2026-10-26T02:00:00Z', ok: false, kind: 'scheduled', code: 'space' },
        ],
        alerts: { failed: '2026-10-26' },
      }),
    );
    const { told, notify } = recorder();
    await backupTick(context('2026-10-27T00:30:00Z'), notify);
    expect(told[0]).toMatchObject({ type: 'backupStale', situation: { reasonCode: 'space' } });
  });
});

describe('a folder that cannot be written', () => {
  it('still tells the owners, once, and still spaces the retries (the memory holds what the folder cannot)', async () => {
    writeFileSync(join(root, 'a-file'), 'x');
    const unusable = { dir: join(root, 'a-file', 'backups') };
    const { told, notify } = recorder();

    expect(await backupTick(context('2026-10-27T02:05:00Z', unusable), notify)).toMatchObject({
      ran: true,
      result: { ok: false, code: 'folder' },
    });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ type: 'backupFailed', situation: { reasonCode: 'folder' } });

    expect(await backupTick(context('2026-10-27T02:10:00Z', unusable), notify)).toEqual({
      ran: false,
      why: 'retry-later',
    });
    await backupTick(context('2026-10-27T02:40:00Z', unusable), notify);
    expect(told).toHaveLength(1);
  });
});
