// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { secretTail } from './secret-tail';

describe('the end of a secret', () => {
  it('is the last four characters of a long one', () => {
    expect(secretTail('https://discord.com/api/webhooks/123456789/abcdEFGHijkl-a1b2')).toBe('a1b2');
    expect(secretTail('s-s4t2ud-0123456789abcdef')).toBe('cdef');
  });

  it('is nothing for a short secret, or a password somebody chose: four characters would be too much of it', () => {
    expect(secretTail('hunter2')).toBeNull();
    expect(secretTail('a-password-1234')).toBeNull();
    expect(secretTail('x'.repeat(15))).toBeNull();
    expect(secretTail('x'.repeat(16))).toBe('xxxx');
  });

  it('is nothing when there is no secret', () => {
    expect(secretTail(undefined)).toBeNull();
    expect(secretTail(null)).toBeNull();
    expect(secretTail('')).toBeNull();
    expect(secretTail('   ')).toBeNull();
  });

  it('ignores the spaces around it', () => {
    expect(secretTail('  s-s4t2ud-0123456789abcdef \n')).toBe('cdef');
  });
});
