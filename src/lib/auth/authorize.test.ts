import { describe, expect, it } from 'vitest';
import { isCampusAllowed, isOwnerLogin } from './authorize';

describe('isCampusAllowed', () => {
  it('allows a campus present in the list', () => {
    expect(isCampusAllowed('Paris', ['Paris', 'Lyon'])).toBe(true);
  });

  it('rejects a campus absent from the list', () => {
    expect(isCampusAllowed('Nice', ['Paris', 'Lyon'])).toBe(false);
  });

  it('allows every campus when the list is empty (no filter)', () => {
    expect(isCampusAllowed('Nice', [])).toBe(true);
  });

  it('ignores case and surrounding whitespace on both sides', () => {
    expect(isCampusAllowed('  paris ', ['Paris'])).toBe(true);
    expect(isCampusAllowed('PARIS', [' paris '])).toBe(true);
  });
});

describe('isOwnerLogin', () => {
  it('matches a login listed as owner', () => {
    expect(isOwnerLogin('jdupont', ['jdupont'])).toBe(true);
  });

  it('rejects a login not listed as owner', () => {
    expect(isOwnerLogin('jdupont', ['adurand'])).toBe(false);
  });

  it('ignores case and surrounding whitespace on both sides', () => {
    expect(isOwnerLogin('JDupont', ['jdupont'])).toBe(true);
    expect(isOwnerLogin('jdupont', [' JDUPONT '])).toBe(true);
  });
});
