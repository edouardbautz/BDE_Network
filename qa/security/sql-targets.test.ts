// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  inputLeaves,
  missingFieldLeaves,
  provenPages,
  routePattern,
  withLeaf,
} from './sql-targets';

const form = (fields: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
};

describe('the strings an attack replaces', () => {
  it('finds a string given as an argument, a number and a boolean, and names them by their key', () => {
    const leaves = inputLeaves([
      'abc',
      { name: 'x', hour: 18, on: true, nothing: null, when: new Date(0) },
    ]);
    expect(leaves.map((leaf) => [leaf.name, leaf.value])).toEqual([
      ['argument 1', 'abc'],
      ['name', 'x'],
      ['hour', 18],
      ['on', true],
    ]);
  });

  it('finds the fields of a form by name, every occurrence of a repeated one, and no file', () => {
    const data = form([
      ['title', 'a'],
      ['assignees', 'p'],
      ['assignees', 'q'],
    ]);
    data.append('logo', new File(['bytes'], 'logo.png'));
    expect(inputLeaves([{}, data]).map((leaf) => [leaf.name, leaf.value])).toEqual([
      ['title', 'a'],
      ['assignees', 'p'],
      ['assignees', 'q'],
    ]);
  });

  it('finds the strings of a list and of what is nested', () => {
    expect(
      inputLeaves([{ matrix: { memberPending: ['discord', 'email'] }, removed: [] }]).map(
        (leaf) => leaf.value,
      ),
    ).toEqual(['discord', 'email']);
  });

  it('replaces one of them and leaves the others, and the original, as they were', () => {
    const original = [{ a: 'one', b: ['two', 'three'] }, 'four'];
    const [first, second] = inputLeaves(original);
    const changed = withLeaf(original, second!, 'X');
    expect(changed).toEqual([{ a: 'one', b: ['X', 'three'] }, 'four']);
    expect(original).toEqual([{ a: 'one', b: ['two', 'three'] }, 'four']);
    expect(withLeaf(original, first!, 'Y')).toEqual([{ a: 'Y', b: ['two', 'three'] }, 'four']);
  });

  it('replaces the right field of a form, and the right occurrence of a repeated one', () => {
    const data = form([
      ['title', 'a'],
      ['assignees', 'p'],
      ['assignees', 'q'],
    ]);
    const leaves = inputLeaves([data]);
    const changed = withLeaf([data], leaves[2]!, 'X')[0] as FormData;
    expect([...changed.entries()]).toEqual([
      ['title', 'a'],
      ['assignees', 'p'],
      ['assignees', 'X'],
    ]);
    expect([...data.entries()].map(([, value]) => value)).toEqual(['a', 'p', 'q']);
  });

  it('keeps a file of a form as it was', () => {
    const data = form([['title', 'a']]);
    data.append('logo', new File(['bytes'], 'logo.png'));
    const changed = withLeaf([data], inputLeaves([data])[0]!, 'X')[0] as FormData;
    expect(changed.get('title')).toBe('X');
    expect((changed.get('logo') as File).name).toBe('logo.png');
  });
});

describe('the fields an action reads that the form does not hold', () => {
  it('are strings of their own, named like the field', () => {
    const data = form([['title', 'a']]);
    const leaves = missingFieldLeaves([{}, data], ['title', 'scope', 'occurrence']);
    expect(leaves.map((leaf) => leaf.name)).toEqual(['scope', 'occurrence']);
  });

  it('are added to a copy of the form, whose original keeps what it held', () => {
    const data = form([['title', 'a']]);
    const [scope] = missingFieldLeaves([data], ['scope']);
    const changed = withLeaf([data], scope!, 'X')[0] as FormData;
    expect([...changed.entries()]).toEqual([
      ['title', 'a'],
      ['scope', 'X'],
    ]);
    expect([...data.entries()]).toEqual([['title', 'a']]);
  });

  it('are asked of a form only: an argument that is not a form has no field', () => {
    expect(missingFieldLeaves(['id', { a: 1 }], ['scope'])).toEqual([]);
  });
});

describe('the pages of the image', () => {
  it('writes the pattern of an address from the key of the image', () => {
    expect(routePattern('app/[locale]/(app)/events/new/page')).toBe('^/(?:en|fr)/events/new$');
    expect(routePattern('app/[locale]/(app)/events/[id]/edit/page')).toBe(
      '^/(?:en|fr)/events/[^/]+/edit$',
    );
    expect(routePattern('app/[locale]/page')).toBe('^/(?:en|fr)$');
    expect(routePattern('app/[locale]/[...rest]/page')).toBe('^/(?:en|fr)/.+$');
  });

  it('matches the addresses of the page, and no other', () => {
    const edit = new RegExp(routePattern('app/[locale]/(app)/events/[id]/edit/page'));
    expect(edit.test('/fr/events/qa-evt-0031-b/edit')).toBe(true);
    expect(edit.test('/en/events/x/edit')).toBe(true);
    expect(edit.test('/de/events/x/edit')).toBe(false);
    expect(edit.test('/fr/events/x/y/edit')).toBe(false);
    expect(edit.test('/fr/events/x/edit/more')).toBe(false);
  });

  it('lists, for each page, the actions it holds that were attacked and the fields they were attacked through', () => {
    const proven = provenPages(
      {
        'events.createEvent': ['app/[locale]/(app)/events/new/page'],
        'events.updateEvent': [
          'app/[locale]/(app)/events/new/page',
          'app/[locale]/(app)/events/[id]/edit/page',
        ],
        'events.deleteEvent': ['app/[locale]/(app)/events/[id]/edit/page'],
      },
      {
        'events.createEvent': ['title', 'location'],
        'events.updateEvent': ['title', 'status'],
      },
    );
    expect(proven.pages).toEqual([
      {
        pattern: '^/(?:en|fr)/events/[^/]+/edit$',
        actions: ['events.updateEvent'],
        fields: ['status', 'title'],
      },
      {
        pattern: '^/(?:en|fr)/events/new$',
        actions: ['events.createEvent', 'events.updateEvent'],
        fields: ['location', 'status', 'title'],
      },
    ]);
  });

  it('adds nothing for an action that was not attacked', () => {
    expect(
      provenPages({ 'events.deleteEvent': ['app/[locale]/(app)/events/new/page'] }, {}).pages,
    ).toEqual([]);
  });
});
