import { describe, expect, it } from 'vitest';
import { NOTICES, readNotice } from './notice';

describe('the notice an address asks for', () => {
  it('is one of ours, or none', () => {
    for (const notice of NOTICES) expect(readNotice(notice)).toBe(notice);
    expect(readNotice('<script>')).toBeNull();
    expect(readNotice(undefined)).toBeNull();
    expect(readNotice('')).toBeNull();
  });

  it('reads the first of several', () => {
    expect(readNotice(['reset', 'x'])).toBe('reset');
    expect(readNotice(['x', 'reset'])).toBeNull();
    expect(readNotice([])).toBeNull();
  });
});
