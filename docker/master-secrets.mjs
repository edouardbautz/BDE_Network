// The keys the platform needs before anything can be configured, kept in the `secrets` Docker volume
// (mounted on /secrets): generated once, on the first start, and found again at every start after.
//
//   auth_secret        signs the session cookies (AUTH_SECRET)
//   settings_key       seals the secret settings in the database (SETTINGS_KEY, see src/lib/settings/crypto.ts)
//   postgres_password  written by the `secrets` service of docker-compose.yml, read here to reach the database
//
// A volume managed by the Docker daemon, not a file of the project folder: it works the same on Windows,
// macOS, Linux, and on a workstation with Docker without administrator rights, where a mounted file is not
// reliable (see docs/architecture.md). Plain JavaScript, no dependency: it runs before the application.
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SECRETS_DIR = '/secrets';
const MIN_AUTH_SECRET_LENGTH = 32;

const readTrimmed = (path) => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
};

/** Writes a file only the owner can read; false when the folder is not there or not writable. */
const persist = (path, value) => {
  try {
    writeFileSync(path, value, { mode: 0o600 });
    chmodSync(path, 0o600);
    return true;
  } catch {
    return false;
  }
};

const isKey = (text) => Buffer.from(text, 'base64').length === 32;

/**
 * Reads the master secrets, creating the ones that do not exist yet. Returns what the application is
 * started with, and `warnings` (French, for the logs) about anything the operator should know.
 *
 * AUTH_SECRET: a valid one in the environment (an installation that has a .env) wins and is kept in the
 * volume, so that changing it in .env still rotates the sessions as it always did; otherwise the one in the
 * volume; otherwise a new one.
 */
export function ensureMasterSecrets({ env, dir = SECRETS_DIR, generate = randomBytes }) {
  const warnings = [];
  let persisted = true;

  const authFile = join(dir, 'auth_secret');
  const keyFile = join(dir, 'settings_key');

  const fromEnv = env.AUTH_SECRET?.trim() ?? '';
  const storedAuth = readTrimmed(authFile);
  let authSecret;
  if (fromEnv.length >= MIN_AUTH_SECRET_LENGTH) {
    authSecret = fromEnv;
    if (storedAuth !== fromEnv) persisted = persist(authFile, fromEnv) && persisted;
  } else {
    if (fromEnv) {
      warnings.push(
        `AUTH_SECRET de .env est trop court (${fromEnv.length} caractères, 32 au minimum) : il est ignoré, la clé du volume « secrets » est utilisée.`,
      );
    }
    if (storedAuth.length >= MIN_AUTH_SECRET_LENGTH) {
      authSecret = storedAuth;
    } else {
      authSecret = generate(48).toString('base64url');
      persisted = persist(authFile, authSecret) && persisted;
    }
  }

  let settingsKey = readTrimmed(keyFile);
  if (!isKey(settingsKey)) {
    settingsKey = generate(32).toString('base64');
    if (!persist(keyFile, settingsKey)) {
      // Nowhere to keep it: the application derives the key from AUTH_SECRET instead (and the secret
      // settings stay readable as long as AUTH_SECRET does).
      persisted = false;
      settingsKey = '';
    }
  }

  if (!persisted) {
    warnings.push(
      "Le volume « secrets » n'est pas utilisable (dossier /secrets absent ou protégé en écriture) : les clés ne sont pas conservées. " +
        'Avec « docker compose », il est créé tout seul ; avec « docker run », ajoutez -v bde_secrets:/secrets.',
    );
  }

  return {
    authSecret,
    settingsKey,
    postgresPassword: readTrimmed(join(dir, 'postgres_password')) || env.POSTGRES_PASSWORD || '',
    persisted,
    warnings,
  };
}
