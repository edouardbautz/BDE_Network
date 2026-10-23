/**
 * The names of the variables as the person who writes a template reads them. A template is stored with stable identifiers
 * (`{title}`); the editor shows them in the language of the interface (`{titre}`, `{catégorie}`) and writes them back as
 * identifiers. Both are understood when typed. Pure, so the browser and the server turn a text the same way.
 */

export type VariableNames = Readonly<Record<string, string>>;

/** A doubled brace stays as it is (it is a brace); a word between braces is a candidate; a mention (`{@…}`) is never one. */
const TOKEN = /\{\{|\}\}|\{([\p{L}][\p{L}\p{N}_]*)\}/gu;

/** A stored text as it is shown: each `{id}` as `{name}`. */
export function toDisplay(text: string, names: VariableNames): string {
  return text.replace(TOKEN, (match, id: string | undefined) =>
    id !== undefined && names[id] !== undefined ? `{${names[id]}}` : match,
  );
}

/** What was typed, as it is stored: each `{name}` of the interface as `{id}`; an identifier typed as it is stays. */
export function fromDisplay(text: string, names: VariableNames): string {
  const ids = new Map(Object.entries(names).map(([id, name]) => [name, id]));
  return text.replace(TOKEN, (match, name: string | undefined) => {
    const id = name === undefined ? undefined : ids.get(name);
    return id === undefined ? match : `{${id}}`;
  });
}

/**
 * Whether the names read without doubt: no two variables share a name, and no name is the identifier of another variable (which
 * `fromDisplay` would then read as that other one).
 */
export function namesAreUnambiguous(names: VariableNames): boolean {
  const entries = Object.entries(names);
  const used = new Set(entries.map(([, name]) => name));
  if (used.size !== entries.length) return false;
  return entries.every(([id, name]) => name === id || !(name in names));
}
