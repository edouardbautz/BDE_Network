import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageAdapter, UploadInput } from '../types';

const UPLOADS_DIR = resolve(process.cwd(), 'storage', 'uploads');

function resolveSafePath(key: string): string {
  const target = resolve(UPLOADS_DIR, key);
  if (target !== UPLOADS_DIR && !target.startsWith(UPLOADS_DIR + sep)) {
    throw new Error(`LocalStorageAdapter: key "${key}" escapes the uploads directory`);
  }
  return target;
}

/** Stores files on local disk under storage/uploads/. Files are served via
 * the /api/files/[...key] route rather than /public, so a future access-
 * control check can sit in front of them without moving anything. */
export class LocalStorageAdapter implements StorageAdapter {
  async upload({ key, data }: UploadInput): Promise<void> {
    const path = resolveSafePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async delete(key: string): Promise<void> {
    await rm(resolveSafePath(key), { force: true });
  }

  getUrl(key: string): string {
    return `/api/files/${key}`;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(resolveSafePath(key));
  }
}
