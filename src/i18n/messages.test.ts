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
      ...['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'].map((r) => `events.recurrence.${r}`),
      ...['WEEKLY', 'BIWEEKLY', 'MONTHLY'].map((r) => `events.notifications.frequency.${r}`),
      ...[
        'required',
        'tooLong',
        'invalid',
        'endBeforeStart',
        'untilRequired',
        'untilBeforeStart',
        'tooManyOccurrences',
      ].map((e) => `events.form.errors.${e}`),
      ...['invalidAssignee', 'notFound'].map((e) => `events.form.formErrors.${e}`),
    ];
    expect(expected.filter((key) => !keys.has(key))).toEqual([]);
  });
});
