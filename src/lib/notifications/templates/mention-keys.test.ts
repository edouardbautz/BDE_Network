import { describe, expect, it } from 'vitest';
import { mentionKeyFor } from './mention-keys';

describe('the name of a mention', () => {
  it('is the label without accents, in lowercase, joined by hyphens', () => {
    expect(mentionKeyFor('Le Bureau', new Set())).toBe('le-bureau');
    expect(mentionKeyFor('  Équipe Événements !! ', new Set())).toBe('equipe-evenements');
  });

  it('falls back on a word when nothing usable is left', () => {
    expect(mentionKeyFor('🎉', new Set())).toBe('mention');
    expect(mentionKeyFor('', new Set())).toBe('mention');
  });

  it('is at most 40 characters, even with a number added', () => {
    const long = 'a'.repeat(80);
    const key = mentionKeyFor(long, new Set());
    expect(key.length).toBeLessThanOrEqual(36);
    expect(mentionKeyFor(long, new Set([key])).length).toBeLessThanOrEqual(40);
  });

  it('takes the next free number when the name is taken', () => {
    expect(mentionKeyFor('Bureau', new Set(['bureau']))).toBe('bureau-2');
    expect(mentionKeyFor('Bureau', new Set(['bureau', 'bureau-2']))).toBe('bureau-3');
  });

  it('always makes a name the directory accepts', () => {
    for (const label of ['A', 'Z z', '--x--', 'ça va ?', '12345', 'a-b-c']) {
      expect(mentionKeyFor(label, new Set())).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});
