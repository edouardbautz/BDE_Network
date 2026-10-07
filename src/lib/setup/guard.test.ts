// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_FAILURES,
  SESSION_TTL_MS,
  formatCode,
  isSetupMode,
  leaveSetupMode,
  normalizeCode,
  setupSessionKey,
  startSetupMode,
  verifySetupCode,
} from './guard';

const CODE_SHAPE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

describe('the installer code', () => {
  beforeEach(() => leaveSetupMode());

  it('is closed until the installation mode starts', () => {
    expect(isSetupMode()).toBe(false);
    expect(verifySetupCode('AAAA-AAAA')).toEqual({ ok: false, reason: 'wrong' });
    expect(setupSessionKey('anything')).toBeNull();
  });

  it('is made of letters and digits that cannot be mistaken, and is different at every start', () => {
    const codes = new Set(Array.from({ length: 20 }, () => startSetupMode()));
    for (const code of codes) expect(code).toMatch(CODE_SHAPE);
    expect(codes.size).toBeGreaterThan(15);
    expect(isSetupMode()).toBe(true);
  });

  it('is accepted however it is typed', () => {
    const code = startSetupMode();
    const plain = code.replace('-', '');
    for (const typed of [
      code,
      plain,
      code.toLowerCase(),
      ` ${plain.slice(0, 4)} ${plain.slice(4)} `,
    ]) {
      expect(verifySetupCode(typed).ok).toBe(true);
    }
    expect(normalizeCode('k7qm 4xpd')).toBe('K7QM4XPD');
    expect(formatCode('K7QM4XPD')).toBe('K7QM-4XPD');
  });

  it('refuses a wrong code, an empty one and a code of another start', () => {
    const first = startSetupMode();
    startSetupMode();
    expect(verifySetupCode(first)).toEqual({ ok: false, reason: 'wrong' });
    expect(verifySetupCode('')).toEqual({ ok: false, reason: 'wrong' });
  });

  describe('the tries', () => {
    it(`lock the entry after ${MAX_FAILURES} wrong ones, even for the right code`, () => {
      const code = startSetupMode();
      const now = 1_000_000;
      for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
        expect(verifySetupCode('WRONG-CODE', now)).toEqual({ ok: false, reason: 'wrong' });
      }
      expect(verifySetupCode('WRONG-CODE', now)).toEqual({
        ok: false,
        reason: 'locked',
        retryAfterSeconds: 30,
      });
      expect(verifySetupCode(code, now + 10_000)).toMatchObject({ ok: false, reason: 'locked' });
      expect(verifySetupCode(code, now + 31_000).ok).toBe(true);
    });

    it('lock longer each time, up to a quarter of an hour', () => {
      startSetupMode();
      let now = 1_000_000;
      const waits: number[] = [];
      for (let lock = 0; lock < 8; lock++) {
        let result = verifySetupCode('WRONG-CODE', now);
        for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
          result = verifySetupCode('WRONG-CODE', now);
        }
        if (result.ok === false && result.reason === 'locked') {
          waits.push(result.retryAfterSeconds);
          now += result.retryAfterSeconds * 1000 + 1;
        }
      }
      expect(waits.slice(0, 5)).toEqual([30, 60, 120, 240, 480]);
      expect(Math.max(...waits)).toBe(900);
    });

    it('start again from nothing after a success', () => {
      const code = startSetupMode();
      for (let attempt = 1; attempt < MAX_FAILURES; attempt++) verifySetupCode('WRONG-CODE');
      expect(verifySetupCode(code).ok).toBe(true);
      for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
        expect(verifySetupCode('WRONG-CODE')).toEqual({ ok: false, reason: 'wrong' });
      }
    });

    it('start again from nothing when the server restarts (a new code)', () => {
      startSetupMode();
      for (let attempt = 0; attempt < MAX_FAILURES; attempt++) verifySetupCode('WRONG-CODE');
      const fresh = startSetupMode();
      expect(verifySetupCode(fresh).ok).toBe(true);
    });
  });

  describe('the session', () => {
    it('is a long random token, kept by the server only as a hash', () => {
      const code = startSetupMode();
      const result = verifySetupCode(code);
      if (!result.ok) throw new Error('code refused');
      expect(result.token.length).toBeGreaterThanOrEqual(40);
      expect(setupSessionKey(result.token)).toMatch(/^[0-9a-f]{64}$/);
      expect(setupSessionKey(result.token)).not.toContain(result.token);
      expect(setupSessionKey(`${result.token}x`)).toBeNull();
      expect(setupSessionKey(undefined)).toBeNull();
    });

    it('gives two people two sessions', () => {
      const code = startSetupMode();
      const a = verifySetupCode(code);
      const b = verifySetupCode(code);
      if (!a.ok || !b.ok) throw new Error('code refused');
      expect(a.token).not.toBe(b.token);
      expect(setupSessionKey(a.token)).not.toBe(setupSessionKey(b.token));
    });

    it('ends after two hours', () => {
      const code = startSetupMode();
      const now = 5_000_000;
      const result = verifySetupCode(code, now);
      if (!result.ok) throw new Error('code refused');
      expect(setupSessionKey(result.token, now + SESSION_TTL_MS - 1)).not.toBeNull();
      expect(setupSessionKey(result.token, now + SESSION_TTL_MS + 1)).toBeNull();
    });

    it('does not survive a restart of the installation mode', () => {
      const result = verifySetupCode(startSetupMode());
      if (!result.ok) throw new Error('code refused');
      startSetupMode();
      expect(setupSessionKey(result.token)).toBeNull();
    });

    it('keeps a limited number of them', () => {
      const code = startSetupMode();
      const first = verifySetupCode(code);
      for (let session = 0; session < 25; session++) verifySetupCode(code);
      if (!first.ok) throw new Error('code refused');
      expect(setupSessionKey(first.token)).toBeNull();
    });
  });

  it('is gone for good once the platform is installed: no code, no session', () => {
    const code = startSetupMode();
    const result = verifySetupCode(code);
    if (!result.ok) throw new Error('code refused');
    leaveSetupMode();
    expect(isSetupMode()).toBe(false);
    expect(setupSessionKey(result.token)).toBeNull();
    expect(verifySetupCode(code)).toEqual({ ok: false, reason: 'wrong' });
  });
});
