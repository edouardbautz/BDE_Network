// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSize } from './format';
import { readOverview } from './list';
import { archiveName } from './names';
import { writeStatus, type BackupStatus } from './status';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bde-list-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date('2026-10-27T12:00:00Z');
const archive = (iso: string, bytes: number) => {
  const name = archiveName(new Date(iso));
  writeFileSync(join(dir, name), Buffer.alloc(bytes, 1));
  return name;
};
const status = (partial: Partial<BackupStatus>): BackupStatus => ({
  version: 1,
  since: '2026-10-01T00:00:00Z',
  attempts: [],
  alerts: {},
  ...partial,
});

describe('what the Settings page says about the backups', () => {
  it('lists the archives, newest first, with their size and how far each was checked', async () => {
    const older = archive('2026-10-25T02:00:00Z', 2_000);
    const newer = archive('2026-10-26T02:00:04Z', 3_000);
    await writeStatus(
      dir,
      status({
        attempts: [
          { at: '2026-10-25T02:00:00Z', ok: true, kind: 'scheduled', name: older, level: 'read' },
          {
            at: '2026-10-26T02:00:04Z',
            ok: true,
            kind: 'manual',
            name: newer,
            level: 'restored',
            bytes: 3000,
          },
        ],
      }),
    );
    const overview = await readOverview(dir, NOW);
    expect(overview.backups.map((b) => b.name)).toEqual([newer, older]);
    expect(overview.backups.map((b) => b.bytes)).toEqual([3_000, 2_000]);
    expect(overview.backups.map((b) => b.level)).toEqual(['restored', 'read']);
    expect(overview.backups[0]?.kind).toBe('manual');
    expect(overview.last?.name).toBe(newer);
    expect(overview.readable).toBe(true);
    expect(overview.stale).toBe(false);
    expect(overview.lastFailure).toBeNull();
  });

  it('ignores whatever is not an automatic backup (a download, a script’s backup, the status, a folder)', async () => {
    archive('2026-10-26T02:00:00Z', 10);
    writeFileSync(join(dir, 'bde-backup-2026-10-26_02-00-00.tar.gz'), 'x');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    mkdirSync(join(dir, archiveName(new Date('2026-10-20T02:00:00Z'))));
    await writeStatus(dir, status({}));
    expect((await readOverview(dir, NOW)).backups).toHaveLength(1);
  });

  it('knows an archive whose attempt is gone from the status, without a level', async () => {
    archive('2026-10-26T02:00:00Z', 10);
    const overview = await readOverview(dir, NOW);
    expect(overview.backups[0]).toMatchObject({ level: null, kind: null });
    expect(overview.last).not.toBeNull();
  });

  it('counts the failures since the last success, and says the reason of the latest', async () => {
    const name = archive('2026-10-26T02:00:00Z', 10);
    await writeStatus(
      dir,
      status({
        attempts: [
          { at: '2026-10-25T02:00:00Z', ok: false, kind: 'scheduled', code: 'space' },
          { at: '2026-10-26T02:00:00Z', ok: true, kind: 'scheduled', name },
          { at: '2026-10-27T02:00:00Z', ok: false, kind: 'scheduled', code: 'dump' },
          { at: '2026-10-27T02:30:00Z', ok: false, kind: 'scheduled', code: 'verify-restore' },
        ],
      }),
    );
    const overview = await readOverview(dir, NOW);
    expect(overview.failuresSince).toBe(2);
    expect(overview.lastFailure).toEqual({
      at: new Date('2026-10-27T02:30:00Z'),
      code: 'verify-restore',
    });
  });

  it('is stale after two days without a success, from the first look when there never was one', async () => {
    await writeStatus(dir, status({ since: '2026-10-24T00:00:00Z' }));
    expect((await readOverview(dir, NOW)).stale).toBe(true);
    await writeStatus(dir, status({ since: '2026-10-26T12:00:00Z' }));
    expect((await readOverview(dir, NOW)).stale).toBe(false);
  });

  it('says the folder is unreadable rather than throwing', async () => {
    const overview = await readOverview(join(dir, 'does-not-exist'), NOW);
    expect(overview.readable).toBe(false);
    expect(overview.folder).toMatchObject({
      problem: 'missing',
      path: join(dir, 'does-not-exist'),
    });
    expect(overview.backups).toEqual([]);
    expect(overview.last).toBeNull();
  });
});

describe('the size of a backup', () => {
  it('is in kilobytes below a megabyte, megabytes below a gigabyte', () => {
    expect(formatSize(108_107, 'en')).toBe('108 kB');
    expect(formatSize(100, 'en')).toBe('1 kB');
    expect(formatSize(12_345_678, 'en')).toBe('12.3 MB');
    expect(formatSize(2_500_000_000, 'en')).toBe('2.5 GB');
    expect(formatSize(12_345_678, 'fr')).toMatch(/^12,3\s?Mo$/);
  });
});
