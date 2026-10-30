// What the buttons of the toolbar of a description do to its text: pure functions from (text, selection) to (text, selection), so that
// the component only has to apply the answer and the rules are tested without a browser. The text stays Markdown, what the reader of
// `lib/markdown.ts` understands and what is copied as it is; nothing here adds HTML or anything the reader would show differently.

export interface Edit {
  text: string;
  /** The selection after the change (start, end): what the person types next replaces it. */
  start: number;
  end: number;
}

export type Format = 'bold' | 'italic' | 'bullets' | 'numbers' | 'heading' | 'link';

/** The words put in when nothing is selected, in the language of the interface. */
export interface Placeholders {
  bold: string;
  italic: string;
  item: string;
  heading: string;
  link: string;
}

const MARKS = { bold: '**', italic: '*' } as const;
/** A bullet or a number at the start of a line, with its space. */
const LIST_MARK = /^(?:[-*+] |\d+\. )/;
const HEADING_MARK = /^#{1,6} /;
const ADDRESS = /^(?:https?:\/\/|mailto:)\S+$/i;

/** The selection, kept inside the text (a textarea gives numbers that are, but a caller may not). */
function within(text: string, start: number, end: number): [number, number] {
  const low = Math.max(0, Math.min(start, end, text.length));
  const high = Math.max(0, Math.min(Math.max(start, end), text.length));
  return [low, high];
}

/**
 * Bold and italic: put the marks around the selection (or around a word to type, selected, when there is none); when the selection is
 * already inside such marks, take them off.
 */
function wrap(text: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const length = mark.length;
  const selected = text.slice(start, end);
  // an italic mark that is half of a bold one is not an italic mark
  const alone = (at: number, side: 'before' | 'after') =>
    mark !== '*' || text[side === 'before' ? at - 1 : at + length] !== '*';

  // the marks are just outside the selection: take them off
  if (
    selected !== '' &&
    text.slice(start - length, start) === mark &&
    text.slice(end, end + length) === mark &&
    alone(start - length, 'before') &&
    alone(end, 'after')
  ) {
    return {
      text: text.slice(0, start - length) + selected + text.slice(end + length),
      start: start - length,
      end: end - length,
    };
  }
  // the marks are inside the selection: take them off
  if (
    selected.length > 2 * length &&
    selected.startsWith(mark) &&
    selected.endsWith(mark) &&
    (mark !== '*' || (selected[length] !== '*' && selected[selected.length - length - 1] !== '*'))
  ) {
    const inner = selected.slice(length, selected.length - length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    };
  }

  const body = selected === '' ? placeholder : selected;
  const next = text.slice(0, start) + mark + body + mark + text.slice(end);
  return { text: next, start: start + length, end: start + length + body.length };
}

/** The lines the selection touches, from the start of the first to the end of the last. */
function linesAround(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // a selection that ends at the very start of a line does not touch that line
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const found = text.indexOf('\n', last);
  return { from, to: found === -1 ? text.length : found };
}

/**
 * A bullet, a number or a heading at the start of every line selected. A second click on the same button takes it off; another kind of
 * list (or heading) is replaced, never stacked. Empty lines are left alone, except when there is nothing else.
 */
function prefixLines(
  text: string,
  start: number,
  end: number,
  kind: 'bullets' | 'numbers' | 'heading',
  placeholder: string,
): Edit {
  const { from, to } = linesAround(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  if (filled.length === 0) {
    const mark = kind === 'bullets' ? '- ' : kind === 'numbers' ? '1. ' : '## ';
    const inserted = `${mark}${placeholder}`;
    const next = text.slice(0, from) + inserted + text.slice(to);
    return { text: next, start: from + mark.length, end: from + inserted.length };
  }

  const same = (line: string) =>
    kind === 'heading'
      ? /^## /.test(line)
      : kind === 'bullets'
        ? /^[-*+] /.test(line)
        : /^\d+\. /.test(line);
  // what is there already, of either sort, goes: a line is a bullet, a number or a heading, never two of them
  const strip = (line: string) => line.replace(HEADING_MARK, '').replace(LIST_MARK, '');
  const off = filled.every(same);
  let number = 0;
  const changed = lines.map((line) => {
    if (line.trim() === '') return line;
    const bare = strip(line);
    if (off) return bare;
    number += 1;
    return `${kind === 'bullets' ? '- ' : kind === 'numbers' ? `${number}. ` : '## '}${bare}`;
  });
  const replaced = changed.join('\n');
  const next = text.slice(0, from) + replaced + text.slice(to);
  return { text: next, start: from, end: from + replaced.length };
}

/**
 * A link: `[the text](https://)` with the address selected to be typed over, or, when the selection is an address, `[text](address)` with
 * the text selected. Nothing selected: a word to type and an address to type.
 */
function link(text: string, start: number, end: number, placeholder: string): Edit {
  const selected = text.slice(start, end);
  if (ADDRESS.test(selected)) {
    const next = `${text.slice(0, start)}[${placeholder}](${selected})${text.slice(end)}`;
    return { text: next, start: start + 1, end: start + 1 + placeholder.length };
  }
  const label = selected === '' ? placeholder : selected;
  const address = 'https://';
  const next = `${text.slice(0, start)}[${label}](${address})${text.slice(end)}`;
  const at = start + label.length + 3;
  return { text: next, start: at, end: at + address.length };
}

/**
 * What a button does. `null` when the result would be longer than the field allows (the field refuses it: nothing changes, instead of a
 * text that the server would cut).
 */
export function applyFormat(
  format: Format,
  text: string,
  selectionStart: number,
  selectionEnd: number,
  placeholders: Placeholders,
  maxLength = Number.POSITIVE_INFINITY,
): Edit | null {
  const [start, end] = within(text, selectionStart, selectionEnd);
  let edit: Edit;
  switch (format) {
    case 'bold':
      edit = wrap(text, start, end, MARKS.bold, placeholders.bold);
      break;
    case 'italic':
      edit = wrap(text, start, end, MARKS.italic, placeholders.italic);
      break;
    case 'bullets':
      edit = prefixLines(text, start, end, 'bullets', placeholders.item);
      break;
    case 'numbers':
      edit = prefixLines(text, start, end, 'numbers', placeholders.item);
      break;
    case 'heading':
      edit = prefixLines(text, start, end, 'heading', placeholders.heading);
      break;
    case 'link':
      edit = link(text, start, end, placeholders.link);
      break;
  }
  return edit.text.length > maxLength && edit.text.length > text.length ? null : edit;
}

/** The format a keyboard shortcut asks for (Ctrl or Cmd + B, I), or null. */
export function shortcutFormat(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): Format | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === 'b' ? 'bold' : key === 'i' ? 'italic' : null;
}

/**
 * The smallest change from one text to another: where it starts, what is replaced and by what. A textarea edited by `insertText` keeps
 * its undo history (Ctrl+Z takes a button's work back), so what is typed into it is only the part that differs.
 */
export function difference(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  let from = 0;
  const shortest = Math.min(before.length, after.length);
  while (from < shortest && before[from] === after[from]) from += 1;
  let tail = 0;
  while (
    tail < shortest - from &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) };
}
