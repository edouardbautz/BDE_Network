import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it.each([
    ['Jean Dupont', 'JD'],
    ['jean dupont', 'JD'],
    ['Marie-Claire Martin Dubois', 'MM'],
    ['ebautz', 'E'],
    ['', ''],
  ])('%j gives %j', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it('does not break on repeated spaces', () => {
    expect(initialsOf('Jean  Dupont')).toBe('JD');
    expect(initialsOf('  Jean Dupont ')).toBe('JD');
  });
});
