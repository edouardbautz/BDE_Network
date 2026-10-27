import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * `manifest.json`, inside every automatic backup: what it holds, and the SHA-256 of each file, so that opening it again says whether
 * it is whole. The files are the ones of scripts/backup.sh (`database.sql`, `logo.tar`, `info.txt`), plus `secrets.tar`, the two keys that
 * the sealed settings and the sessions need: one archive is enough to start again on a server with nothing.
 */
export const MANIFEST_FILE = 'manifest.json';
export const DATABASE_FILE = 'database.sql';
export const SECRETS_FILE = 'secrets.tar';
export const LOGO_FILE = 'logo.tar';
export const INFO_FILE = 'info.txt';

/** The keys of the `secrets` volume that are saved. The password of the database is not: a dump restores into any password. */
export const SECRET_NAMES = ['auth_secret', 'settings_key'] as const;

export interface FileEntry {
  bytes: number;
  sha256: string;
}

export interface Manifest {
  format: 1;
  createdAt: string;
  /** The version of the platform that made it. */
  version: string;
  timeZone: string;
  /** Whether the keys are in it (a platform started with `docker run` and no `secrets` volume has none). */
  secrets: boolean;
  logo: boolean;
  files: Record<string, FileEntry>;
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const SHA256 = /^[0-9a-f]{64}$/;

export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('the manifest is not JSON');
  }
  const manifest = raw as Partial<Manifest> | null;
  if (!manifest || manifest.format !== 1) throw new Error('the manifest is of another format');
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('the manifest has no date');
  }
  const files = manifest.files;
  if (!files || typeof files !== 'object' || !files[DATABASE_FILE]) {
    throw new Error('the manifest does not list the database');
  }
  for (const [name, entry] of Object.entries(files)) {
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
      throw new Error('the manifest names a file outside the archive');
    }
    if (!entry || typeof entry.bytes !== 'number' || !SHA256.test(String(entry.sha256))) {
      throw new Error(`the manifest is wrong about ${name}`);
    }
  }
  return {
    format: 1,
    createdAt: manifest.createdAt,
    version: String(manifest.version ?? 'unknown'),
    timeZone: String(manifest.timeZone ?? 'UTC'),
    secrets: manifest.secrets === true,
    logo: manifest.logo === true,
    files,
  };
}
