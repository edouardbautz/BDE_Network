// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeFolder, diagnoseFolder, type FolderTools } from './folder';

/** What the system answers for a folder, played without the rights of a real machine (the problems of a rootless Docker are not those of the computer running the tests). */
function folderOf(
  patch: {
    exists?: boolean;
    directory?: boolean;
    mode?: number;
    uid?: number;
    dev?: number;
    list?: string;
    write?: string;
    container?: boolean;
  } = {},
): FolderTools {
  const failure = (code: string) => Object.assign(new Error(code), { code });
  const entry = (dev: number, directory: boolean, mode: number, uid: number) => ({
    isDirectory: () => directory,
    mode,
    uid,
    gid: uid,
    dev,
  });
  return {
    stat: (async (path: string) => {
      if (path === '/') return entry(1, true, 0o755, 0);
      if (patch.exists === false) throw failure('ENOENT');
      return entry(
        patch.dev ?? 2,
        patch.directory ?? true,
        patch.mode ?? 0o40755,
        patch.uid ?? 1001,
      );
    }) as unknown as FolderTools['stat'],
    readdir: (async () => {
      if (patch.list) throw failure(patch.list);
      return [];
    }) as unknown as FolderTools['readdir'],
    access: (async () => {
      if (patch.write) throw failure(patch.write);
    }) as unknown as FolderTools['access'],
    inContainer: () => patch.container ?? false,
    uid: () => 1001,
  };
}

const ENV = { BDE_BACKUP_HOST_DIR: './backups/auto' };

describe('the diagnosis of the folder of the backups', () => {
  it('finds nothing wrong with a folder the application owns', async () => {
    const found = await diagnoseFolder('/auto-backups', ENV, folderOf());
    expect(found).toMatchObject({
      problem: null,
      path: '/auto-backups',
      hostPath: './backups/auto',
      uid: 1001,
      owner: { uid: 1001, gid: 1001, mode: '755' },
    });
  });

  it('names a folder that is not there', async () => {
    expect(await diagnoseFolder('/auto-backups', ENV, folderOf({ exists: false }))).toMatchObject({
      problem: 'missing',
      code: 'ENOENT',
      owner: null,
    });
  });

  it('names something that is not a folder', async () => {
    expect(
      await diagnoseFolder('/auto-backups', ENV, folderOf({ directory: false })),
    ).toMatchObject({
      problem: 'notDirectory',
    });
  });

  it("names a folder the application's user cannot list, with who owns it and with which rights (a rootless Docker on a network disk)", async () => {
    const found = await diagnoseFolder(
      '/auto-backups',
      ENV,
      folderOf({ uid: 0, mode: 0o40700, list: 'EACCES' }),
    );
    expect(found).toMatchObject({
      problem: 'unreadable',
      code: 'EACCES',
      owner: { uid: 0, gid: 0, mode: '700' },
    });
  });

  it('names a folder that can be listed and not written (rights, or a disk mounted read-only)', async () => {
    expect(
      await diagnoseFolder('/auto-backups', ENV, folderOf({ uid: 0, write: 'EACCES' })),
    ).toMatchObject({ problem: 'notWritable', code: 'EACCES' });
    expect(await diagnoseFolder('/auto-backups', ENV, folderOf({ write: 'EROFS' }))).toMatchObject({
      problem: 'notWritable',
      code: 'EROFS',
    });
  });

  it("names a folder that is the container's own disk, not a folder of the server", async () => {
    expect(
      await diagnoseFolder('/auto-backups', ENV, folderOf({ container: true, dev: 1 })),
    ).toMatchObject({ problem: 'notMounted' });
    // a mounted folder is on another device; outside a container the question does not arise
    expect(
      (await diagnoseFolder('/auto-backups', ENV, folderOf({ container: true, dev: 2 }))).problem,
    ).toBeNull();
    expect(
      (await diagnoseFolder('/auto-backups', ENV, folderOf({ container: false, dev: 1 }))).problem,
    ).toBeNull();
  });

  it('puts what cannot be used before what is only suspicious', async () => {
    expect(
      (
        await diagnoseFolder(
          '/auto-backups',
          ENV,
          folderOf({ container: true, dev: 1, list: 'EACCES' }),
        )
      ).problem,
    ).toBe('unreadable');
  });

  it('does not know the host folder when the compose file did not say it', async () => {
    expect((await diagnoseFolder('/auto-backups', {}, folderOf())).hostPath).toBeNull();
    expect(
      (await diagnoseFolder('/auto-backups', { BDE_BACKUP_HOST_DIR: ' ' }, folderOf())).hostPath,
    ).toBeNull();
  });

  it('says it on one line for the logs, with the path, the user, the owner, the rights and the code', async () => {
    const line = describeFolder(
      await diagnoseFolder(
        '/auto-backups',
        ENV,
        folderOf({ uid: 0, mode: 0o40700, list: 'EACCES' }),
      ),
    );
    expect(line).toBe(
      '/auto-backups ne peut pas être lu, utilisateur de la plateforme 1001, propriétaire 0:0, droits 700, code EACCES, sur le serveur : ./backups/auto',
    );
    expect(describeFolder(await diagnoseFolder('/x', {}, folderOf()))).toContain('est utilisable');
  });
});

describe('the diagnosis on a real folder', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bde-folder-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds a usable folder usable, a missing one missing, a file not a folder', async () => {
    expect((await diagnoseFolder(dir, {})).problem).toBeNull();
    expect((await diagnoseFolder(join(dir, 'nope'), {})).problem).toBe('missing');
    await writeFile(join(dir, 'file'), 'x');
    expect((await diagnoseFolder(join(dir, 'file'), {})).problem).toBe('notDirectory');
  });
});
