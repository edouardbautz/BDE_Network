// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureMasterSecrets } from './master-secrets.mjs';

describe('ensureMasterSecrets', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bde-secrets-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (name: string) => readFileSync(join(dir, name), 'utf8');

  it('creates the keys on the first start, and finds the same ones at every start after', () => {
    const first = ensureMasterSecrets({ env: {}, dir });
    expect(first.authSecret.length).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(first.settingsKey, 'base64')).toHaveLength(32);
    expect(first.persisted).toBe(true);
    expect(first.warnings).toEqual([]);
    expect(read('auth_secret')).toBe(first.authSecret);
    expect(read('settings_key')).toBe(first.settingsKey);

    const second = ensureMasterSecrets({ env: {}, dir });
    expect(second.authSecret).toBe(first.authSecret);
    expect(second.settingsKey).toBe(first.settingsKey);
  });

  it('gives two installations different keys', () => {
    const other = mkdtempSync(join(tmpdir(), 'bde-secrets-'));
    try {
      const a = ensureMasterSecrets({ env: {}, dir });
      const b = ensureMasterSecrets({ env: {}, dir: other });
      expect(a.authSecret).not.toBe(b.authSecret);
      expect(a.settingsKey).not.toBe(b.settingsKey);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('keeps them readable by their owner only', () => {
    ensureMasterSecrets({ env: {}, dir });
    expect(statSync(join(dir, 'auth_secret')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'settings_key')).mode & 0o777).toBe(0o600);
  });

  describe('AUTH_SECRET', () => {
    const fromEnv = 'a-session-secret-from-the-env-file-0123456789';

    it('adopts the one of an existing .env, so the sessions of an installation that predates the volume survive', () => {
      const secrets = ensureMasterSecrets({ env: { AUTH_SECRET: fromEnv }, dir });
      expect(secrets.authSecret).toBe(fromEnv);
      expect(read('auth_secret')).toBe(fromEnv);
    });

    it('still lets .env rotate it: a new value there replaces the one of the volume', () => {
      ensureMasterSecrets({ env: { AUTH_SECRET: fromEnv }, dir });
      const rotated = `${fromEnv}-rotated`;
      expect(ensureMasterSecrets({ env: { AUTH_SECRET: rotated }, dir }).authSecret).toBe(rotated);
      expect(read('auth_secret')).toBe(rotated);
    });

    it('keeps the one of the volume once .env is gone', () => {
      ensureMasterSecrets({ env: { AUTH_SECRET: fromEnv }, dir });
      expect(ensureMasterSecrets({ env: {}, dir }).authSecret).toBe(fromEnv);
    });

    it('ignores a value that is too short, says so, and does not take it for a key', () => {
      const secrets = ensureMasterSecrets({ env: { AUTH_SECRET: 'short' }, dir });
      expect(secrets.authSecret).not.toBe('short');
      expect(secrets.authSecret.length).toBeGreaterThanOrEqual(32);
      expect(secrets.warnings.join('\n')).toContain('trop court');
      expect(secrets.warnings.join('\n')).not.toContain('short');
    });
  });

  describe('SETTINGS_KEY', () => {
    it('is not replaced when the file holds a valid one', () => {
      const key = randomBytes(32).toString('base64');
      writeFileSync(join(dir, 'settings_key'), `${key}\n`);
      expect(ensureMasterSecrets({ env: {}, dir }).settingsKey).toBe(key);
    });

    it('is made again when the file holds something that is not a key', () => {
      writeFileSync(join(dir, 'settings_key'), 'garbage');
      const { settingsKey } = ensureMasterSecrets({ env: {}, dir });
      expect(Buffer.from(settingsKey, 'base64')).toHaveLength(32);
    });
  });

  describe('the database password', () => {
    it('comes from the file the `secrets` service wrote, before the environment', () => {
      writeFileSync(join(dir, 'postgres_password'), 'from-the-volume');
      expect(
        ensureMasterSecrets({ env: { POSTGRES_PASSWORD: 'from-env' }, dir }).postgresPassword,
      ).toBe('from-the-volume');
    });

    it('comes from the environment without the volume (docker run, CI), else is empty', () => {
      expect(
        ensureMasterSecrets({ env: { POSTGRES_PASSWORD: 'from-env' }, dir }).postgresPassword,
      ).toBe('from-env');
      expect(ensureMasterSecrets({ env: {}, dir }).postgresPassword).toBe('');
    });
  });

  it('still starts, without keeping anything, when there is no volume to keep the keys in', () => {
    const missing = join(dir, 'no', 'such', 'folder');
    const secrets = ensureMasterSecrets({ env: {}, dir: missing });
    expect(secrets.authSecret.length).toBeGreaterThanOrEqual(32);
    expect(secrets.settingsKey).toBe(''); // the application derives it from AUTH_SECRET
    expect(secrets.persisted).toBe(false);
    expect(secrets.warnings.join('\n')).toContain('volume « secrets »');
  });
});
