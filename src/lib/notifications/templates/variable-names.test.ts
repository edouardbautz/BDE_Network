import { describe, expect, it } from 'vitest';
import en from '../../../../messages/en.json';
import fr from '../../../../messages/fr.json';
import { VARIABLES } from './catalog';
import { fromDisplay, namesAreUnambiguous, toDisplay } from './variable-names';

const NAMES = { title: 'titre', category: 'catégorie', place: 'lieu', bde: 'bde' };

describe('the names of the variables', () => {
  it('shows the identifiers by their names, and keeps a doubled brace and what it does not know', () => {
    expect(toDisplay('{title} à {place} {{x}} {unknown} {bde}', NAMES)).toBe(
      '{titre} à {lieu} {{x}} {unknown} {bde}',
    );
    expect(toDisplay('{category}', NAMES)).toBe('{catégorie}');
  });

  it('writes what was typed back as identifiers, and leaves an identifier typed as it is', () => {
    expect(fromDisplay('{titre} à {lieu} et {title}', NAMES)).toBe('{title} à {place} et {title}');
    expect(fromDisplay('{catégorie} {{lieu}} {inconnu}', NAMES)).toBe(
      '{category} {{lieu}} {inconnu}',
    );
  });

  it('never reads a mention as a variable', () => {
    expect(fromDisplay('{@everyone} {@role:staff}', { everyone: 'x' })).toBe(
      '{@everyone} {@role:staff}',
    );
  });

  it('round-trips', () => {
    const stored = 'Bonjour {title}, {category} — {place}';
    expect(fromDisplay(toDisplay(stored, NAMES), NAMES)).toBe(stored);
  });

  it('knows names that cannot be told apart', () => {
    expect(namesAreUnambiguous(NAMES)).toBe(true);
    expect(namesAreUnambiguous({ a: 'x', b: 'x' })).toBe(false);
    expect(namesAreUnambiguous({ a: 'b', b: 'c' })).toBe(false);
  });
});

describe('the names the interface gives', () => {
  const ids = [...new Set(Object.values(VARIABLES).flat())];
  for (const [language, messages] of [
    ['French', fr],
    ['English', en],
  ] as const) {
    const names = (
      messages as unknown as { templates?: { variables?: Record<string, { name: string }> } }
    ).templates?.variables;

    it(`${language}: every variable has a name made of letters, and none can be mistaken for another`, () => {
      expect(names).toBeDefined();
      const table = Object.fromEntries(ids.map((id) => [id, names?.[id]?.name ?? '']));
      for (const [id, name] of Object.entries(table)) {
        expect(name, id).toMatch(/^[\p{L}][\p{L}\p{N}_]*$/u);
      }
      expect(namesAreUnambiguous(table)).toBe(true);
    });
  }
});
