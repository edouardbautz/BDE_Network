// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seal, settingsKey, SettingsDecryptError, unseal } from './crypto';

const key = () => randomBytes(32);

describe('seal / unseal', () => {
  it('gives back what was sealed', () => {
    const k = key();
    const values = {
      FORTYTWO_CLIENT_SECRET: 's-1234',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/x',
    };
    expect(unseal(seal(values, k), k)).toEqual(values);
  });

  it('shows nothing of the values, and never seals the same text twice the same way', () => {
    const k = key();
    const a = seal({ SMTP_PASSWORD: 'hunter2-hunter2' }, k);
    const b = seal({ SMTP_PASSWORD: 'hunter2-hunter2' }, k);
    expect(a).not.toContain('hunter2');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
  });

  it('refuses another key: what a lost `secrets` volume looks like', () => {
    const sealed = seal({ SMTP_PASSWORD: 'x' }, key());
    expect(() => unseal(sealed, key())).toThrow(SettingsDecryptError);
  });

  it('refuses text that was altered, in any of its parts', () => {
    const k = key();
    const [version, iv, tag, data] = seal({ SMTP_PASSWORD: 'x' }, k).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const flip = (part: string) => `${part.slice(0, -2)}${part.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const altered of [
      [version, flip(iv), tag, data],
      [version, iv, flip(tag), data],
      [version, iv, tag, flip(data)],
      ['v2', iv, tag, data],
      [version, iv, tag],
    ]) {
      expect(() => unseal(altered.join('.'), k)).toThrow(SettingsDecryptError);
    }
  });

  it('refuses anything that is not sealed text', () => {
    expect(() => unseal('', key())).toThrow(SettingsDecryptError);
    expect(() => unseal('not sealed at all', key())).toThrow(SettingsDecryptError);
  });
});

describe('settingsKey', () => {
  it('uses SETTINGS_KEY, the one the container keeps in the secrets volume', () => {
    const raw = randomBytes(32);
    expect(settingsKey({ SETTINGS_KEY: raw.toString('base64') }).equals(raw)).toBe(true);
  });

  it('refuses a SETTINGS_KEY of the wrong length', () => {
    expect(() => settingsKey({ SETTINGS_KEY: randomBytes(16).toString('base64') })).toThrow(
      /32 bytes/,
    );
  });

  it('derives a stable key from AUTH_SECRET when there is no SETTINGS_KEY (dev, tests)', () => {
    const env = { AUTH_SECRET: 'a-secret-of-at-least-thirty-two-characters' };
    expect(settingsKey(env).equals(settingsKey(env))).toBe(true);
    expect(settingsKey(env)).toHaveLength(32);
    expect(settingsKey({ AUTH_SECRET: `${env.AUTH_SECRET}x` }).equals(settingsKey(env))).toBe(
      false,
    );
  });

  it('does not use AUTH_SECRET itself as the key', () => {
    const secret = 'a-secret-of-at-least-thirty-two-characters';
    expect(settingsKey({ AUTH_SECRET: secret }).toString('utf8')).not.toContain(secret.slice(0, 8));
  });

  it('has nothing to work with without either', () => {
    expect(() => settingsKey({})).toThrow(/cannot be sealed/);
  });
});
