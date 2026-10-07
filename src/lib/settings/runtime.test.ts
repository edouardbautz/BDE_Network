// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BdeConfig } from '@/config/schema';
import {
  effectiveEnvironment,
  getRuntimeConfig,
  setRuntimeSettings,
  setting,
  SETTING_KEYS,
  SECRET_SETTING_KEYS,
} from './runtime';

const config = { bde: { name: 'From the database' } } as BdeConfig;

describe('runtime settings', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    setRuntimeSettings(undefined);
    process.env.APP_URL = 'https://from-env.example';
    process.env.SMTP_HOST = 'smtp.from-env.example';
    process.env.AUTH_SECRET = 'not-a-managed-setting';
  });
  afterEach(() => {
    setRuntimeSettings(undefined);
    process.env = { ...saved };
  });

  it('reads the environment while nothing is loaded from the database', () => {
    expect(setting('APP_URL')).toBe('https://from-env.example');
    expect(getRuntimeConfig()).toBeUndefined();
  });

  it('counts a blank value as not set', () => {
    process.env.SMTP_HOST = '   ';
    expect(setting('SMTP_HOST')).toBeUndefined();
    delete process.env.SMTP_HOST;
    expect(setting('SMTP_HOST')).toBeUndefined();
  });

  it('reads the database once it is loaded, and ignores what .env still says', () => {
    setRuntimeSettings({
      config,
      values: { APP_URL: 'https://from-database.example' },
      source: 'database',
    });
    expect(setting('APP_URL')).toBe('https://from-database.example');
    expect(setting('SMTP_HOST')).toBeUndefined(); // set in .env, not in the database: not used
    expect(getRuntimeConfig()?.bde.name).toBe('From the database');
  });

  it('builds the environment the checks look at: the real one, the managed settings from the database', () => {
    setRuntimeSettings({
      config,
      values: { APP_URL: 'https://from-database.example' },
      source: 'database',
    });
    const env = effectiveEnvironment();
    expect(env.APP_URL).toBe('https://from-database.example');
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.AUTH_SECRET).toBe('not-a-managed-setting'); // not managed: left alone
  });

  it('leaves the environment alone while nothing is loaded', () => {
    expect(effectiveEnvironment().SMTP_HOST).toBe('smtp.from-env.example');
  });

  it('knows which settings are secrets, and only those', () => {
    expect([...SECRET_SETTING_KEYS].sort()).toEqual([
      'DISCORD_WEBHOOK_URL',
      'FORTYTWO_CLIENT_SECRET',
      'SLACK_WEBHOOK_URL',
      'SMTP_PASSWORD',
    ]);
    for (const key of SECRET_SETTING_KEYS) expect(SETTING_KEYS).toContain(key);
    expect(SECRET_SETTING_KEYS).not.toContain('FORTYTWO_CLIENT_ID');
  });
});
