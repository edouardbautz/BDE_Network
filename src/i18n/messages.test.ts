import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

type Catalog = { [key: string]: string | string[] | Catalog };

function flatten(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === 'string' || Array.isArray(value)
      ? [`${prefix}${key}`]
      : flatten(value, `${prefix}${key}.`),
  );
}

describe('message catalogs', () => {
  it('define exactly the same keys in French and English', () => {
    const frKeys = new Set(flatten(fr));
    const enKeys = new Set(flatten(en));
    expect([...frKeys].filter((key) => !enKeys.has(key))).toEqual([]);
    expect([...enKeys].filter((key) => !frKeys.has(key))).toEqual([]);
  });

  it('name every control with the text it shows (WCAG 2.5.3, "label in name")', () => {
    // By convention `xLabel` is the accessible name of the control whose visible text is `x`: the name must contain the text,
    // or somebody who speaks to their computer ("click Make default") is not understood by the control they see.
    const pairs = (catalog: Catalog, prefix = ''): [string, string, string][] =>
      Object.entries(catalog).flatMap(([key, value]) => {
        if (typeof value !== 'string') {
          return Array.isArray(value) ? [] : pairs(value, `${prefix}${key}.`);
        }
        const visible = key.endsWith('Label') ? catalog[key.slice(0, -'Label'.length)] : undefined;
        return typeof visible === 'string' ? [[`${prefix}${key}`, visible, value]] : [];
      });

    for (const [name, catalog] of [
      ['fr', fr],
      ['en', en],
    ] as const) {
      const found = pairs(catalog as Catalog);
      expect(found.length, `no pair found in ${name}: the convention changed?`).toBeGreaterThan(0);
      const missing = found
        .filter(([, visible, label]) => !label.toLowerCase().includes(visible.toLowerCase()))
        .map(([key, visible, label]) => `${name} ${key}: "${label}" does not contain "${visible}"`);
      expect(missing).toEqual([]);
    }
  });

  it('have no empty strings', () => {
    for (const catalog of [fr, en] as Catalog[]) {
      const empty = flatten(catalog).filter((key) => {
        const value = key
          .split('.')
          .reduce<string | string[] | Catalog>((node, part) => (node as Catalog)[part]!, catalog);
        return value === '';
      });
      expect(empty).toEqual([]);
    }
  });

  it('cover every dynamic key the events module builds at runtime', () => {
    const keys = new Set(flatten(fr));
    const expected = [
      ...['DRAFT', 'CONFIRMED'].map((s) => `events.status.${s}`),
      ...[
        'required',
        'tooLong',
        'invalid',
        'endBeforeStart',
        'untilRequired',
        'untilBeforeStart',
        'tooManyOccurrences',
        'intervalInvalid',
        'weekdaysRequired',
        'countInvalid',
        'monthlyUnavailable',
      ].map((e) => `events.form.errors.${e}`),
      ...['invalidAssignee', 'notFound'].map((e) => `events.form.formErrors.${e}`),
    ];
    expect(expected.filter((key) => !keys.has(key))).toEqual([]);
  });
});
