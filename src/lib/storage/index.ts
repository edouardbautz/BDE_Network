import { LocalStorageAdapter } from './adapters/local';
import type { StorageAdapter } from './types';

/** Only the local adapter exists today. Swap this factory for a
 * config-driven pick ("local" | "s3") once an S3 adapter implementing
 * StorageAdapter is added — no other code should need to change. */
export function getStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter();
}

export type { StorageAdapter, UploadInput } from './types';
