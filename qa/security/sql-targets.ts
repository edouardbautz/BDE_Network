/**
 * What the `sql` suite attacks, and what it has proven: the pure parts (no database, no image), tested in `sql-targets.test.ts`.
 *
 * The suite plays every server action with the text of its arguments replaced, one at a time, by what a SQL injection sends. "The
 * text of its arguments" is every string a crafted request can put there: the fields of a form (`FormData`), the strings of an
 * object, a string given as an argument (an identifier, a login, a code: a request can send anything in them). The arguments to
 * start from are the ones of the access matrix (`qa/access/actions.ts`), which the CI forces to hold a case for every action of the platform.
 */

/** A step to a string inside the arguments: an index (an array or the list of arguments), a key, or a field of a form. */
export type Step = number | string | { form: string; occurrence: number } | { append: string };

export interface Leaf {
  path: Step[];
  /** What it is called: the name of the field of a form, the keys of an object, or `argument 2`. Which is what ZAP names a parameter. */
  name: string;
  value: string | number | boolean;
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof FormData) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Every scalar the arguments hold, with the way to it: a string, and also a number or a boolean (a crafted request sends a string where the page
 * sends a number, and what the action does with it is what is attacked). A file of a form or a date holds no text and is not one.
 */
export function inputLeaves(args: readonly unknown[]): Leaf[] {
  const leaves: Leaf[] = [];
  const walk = (value: unknown, path: Step[], name: string) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      leaves.push({ path, name, value });
    } else if (value instanceof FormData) {
      const seen = new Map<string, number>();
      for (const [field, entry] of value.entries()) {
        const occurrence = seen.get(field) ?? 0;
        seen.set(field, occurrence + 1);
        if (typeof entry === 'string')
          leaves.push({ path: [...path, { form: field, occurrence }], name: field, value: entry });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index], name));
    } else if (isPlain(value)) {
      for (const [key, item] of Object.entries(value)) walk(item, [...path, key], key);
    }
  };
  args.forEach((argument, index) => walk(argument, [index], `argument ${index + 1}`));
  return leaves;
}

/**
 * The fields the action reads from a form that the form of the arguments does not hold: each one is a string of its own to attack (the form as it is,
 * and this field added). The value in the leaf is empty: it is replaced, never sent as it is.
 */
export function missingFieldLeaves(args: readonly unknown[], fields: readonly string[]): Leaf[] {
  const leaves: Leaf[] = [];
  args.forEach((argument, index) => {
    if (!(argument instanceof FormData)) return;
    for (const field of fields)
      if (!argument.has(field))
        leaves.push({ path: [index, { append: field }], name: field, value: '' });
  });
  return leaves;
}

/** The arguments with one string replaced (a copy: the others, and the original, are as they were). */
export function withLeaf(args: readonly unknown[], leaf: Leaf, replacement: string): unknown[] {
  const copy = (value: unknown, path: readonly Step[]): unknown => {
    const [head, ...rest] = path;
    if (head === undefined) return replacement;
    if (value instanceof FormData && typeof head === 'object' && 'append' in head) {
      // a field the form does not hold: added, with what an attack puts in it
      const form = new FormData();
      for (const [field, entry] of value.entries()) form.append(field, entry);
      form.append(head.append, replacement);
      return form;
    }
    if (value instanceof FormData && typeof head === 'object' && 'form' in head) {
      const form = new FormData();
      let seen = 0;
      for (const [field, entry] of value.entries()) {
        if (field === head.form && typeof entry === 'string') {
          const here = seen;
          seen += 1;
          if (here === head.occurrence) {
            form.append(field, copy(entry, rest) as string);
            continue;
          }
        }
        form.append(field, entry);
      }
      return form;
    }
    if (Array.isArray(value))
      return value.map((item, index) => (index === head ? copy(item, rest) : item));
    if (isPlain(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, key === head ? copy(item, rest) : item]),
      );
    return value;
  };
  return copy(args, leaf.path) as unknown[];
}

/**
 * The pattern of the addresses a page answers on, from the key the image gives it (`app/[locale]/(app)/events/[id]/edit/page`): the
 * locale is either, a route group is not in the address, a dynamic segment is any one segment. Anchored, and matched against a pathname.
 */
export function routePattern(worker: string): string {
  const segments = worker
    .replace(/^app\//, '')
    .replace(/\/page$/, '')
    .split('/')
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
    .map((segment) => {
      if (segment === '[locale]') return '(?:en|fr)';
      if (/^\[\.\.\..+\]$/.test(segment)) return '.+';
      if (/^\[.+\]$/.test(segment)) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
  return `^/${segments.join('/')}$`;
}

/** What the suite has proven for one page: the actions it holds, and the names of the fields those actions were attacked through. */
export interface ProvenPage {
  pattern: string;
  actions: string[];
  fields: string[];
}

export interface Proven {
  pages: ProvenPage[];
}

/**
 * The pages of the image whose text actions were all attacked. `hosts` says, for each action, the pages of the image that hold it; `played` says, for
 * each action the suite attacks, the names of the fields it was attacked through. A page is listed with the fields of the actions it holds that were
 * played; an action that was not played (it takes no text, or has no case with any) adds nothing: an alert on a field that none of the actions of
 * its page was attacked through is not covered.
 */
export function provenPages(
  hosts: Record<string, readonly string[]>,
  played: Record<string, readonly string[]>,
): Proven {
  const pages = new Map<string, ProvenPage>();
  for (const [action, fields] of Object.entries(played)) {
    for (const worker of hosts[action] ?? []) {
      const pattern = routePattern(worker);
      const page = pages.get(pattern) ?? { pattern, actions: [], fields: [] };
      page.actions.push(action);
      for (const field of fields) if (!page.fields.includes(field)) page.fields.push(field);
      pages.set(pattern, page);
    }
  }
  return {
    pages: [...pages.values()]
      .map((page) => ({ ...page, actions: page.actions.sort(), fields: page.fields.sort() }))
      .sort((a, b) => a.pattern.localeCompare(b.pattern)),
  };
}
