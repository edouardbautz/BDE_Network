import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Seals the secret settings (42 client secret, SMTP password, webhook addresses) before they are written to
 * the database: AES-256-GCM, a fresh random IV each time, the format authenticated.
 *
 * The key is NOT in the database. In the Docker image it is generated once into the `secrets` volume
 * (docker/start.mjs) and passed to the server as SETTINGS_KEY; without it (`npm run dev`, tests) it is derived
 * from AUTH_SECRET. A database dump alone therefore does not give the secrets away, and a restoration on
 * another server needs the `secrets` volume back (scripts/backup.sh saves it apart).
 */

const VERSION = 'v1';
const ASSOCIATED_DATA = Buffer.from('bde-network:platform-settings:v1');

/** The sealed text cannot be opened: wrong key (the `secrets` volume was lost), or altered. */
export class SettingsDecryptError extends Error {
  constructor() {
    super('The sealed settings cannot be decrypted with the current key.');
  }
}

export function settingsKey(env: Record<string, string | undefined> = process.env): Buffer {
  const explicit = env.SETTINGS_KEY?.trim();
  if (explicit) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length !== 32) {
      throw new Error('SETTINGS_KEY must be 32 bytes encoded in base64.');
    }
    return key;
  }

  const secret = env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error('Neither SETTINGS_KEY nor AUTH_SECRET is set: the settings cannot be sealed.');
  }
  return Buffer.from(hkdfSync('sha256', secret, 'bde-network', 'settings-key', 32));
}

const encode = (data: Buffer): string => data.toString('base64url');

export function seal(values: Record<string, string>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(ASSOCIATED_DATA);
  const data = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
  return [VERSION, encode(iv), encode(cipher.getAuthTag()), encode(data)].join('.');
}

export function unseal(sealed: string, key: Buffer): Record<string, string> {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) throw new SettingsDecryptError();

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(ASSOCIATED_DATA);
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const text = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SettingsDecryptError();
    }
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'string') values[name] = value;
    }
    return values;
  } catch {
    throw new SettingsDecryptError();
  }
}
