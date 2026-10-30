// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';
import { applyFormat, difference, shortcutFormat, type Format } from './markdown-edit';

const WORDS = {
  bold: 'texte en gras',
  italic: 'texte en italique',
  item: 'élément',
  heading: 'Titre',
  link: 'texte du lien',
};

/** Writes the selection as `[…]` so a case reads like what the person sees. */
const show = (edit: { text: string; start: number; end: number }) =>
  `${edit.text.slice(0, edit.start)}[${edit.text.slice(edit.start, edit.end)}]${edit.text.slice(edit.end)}`;

/** Applies a format to a text written with its selection in `[…]`. */
function run(format: Format, marked: string, max?: number): string | null {
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  const text = marked.replace('[', '').replace(']', '');
  const edit = applyFormat(format, text, start, end, WORDS, max);
  return edit && show(edit);
}

describe('bold and italic', () => {
  it('put the marks around the selection and keep it selected, so that the next click takes them off', () => {
    expect(run('bold', 'une [soirée] ici')).toBe('une **[soirée]** ici');
    expect(run('italic', 'une [soirée] ici')).toBe('une *[soirée]* ici');
  });

  it('put a word to type, selected, where nothing is selected', () => {
    expect(run('bold', 'a [] b')).toBe('a **[texte en gras]** b');
    expect(run('italic', '[]')).toBe('*[texte en italique]*');
  });

  it('take the marks off when the selection is inside them, or holds them', () => {
    expect(run('bold', 'une **[soirée]** ici')).toBe('une [soirée] ici');
    expect(run('bold', 'une [**soirée**] ici')).toBe('une [soirée] ici');
    expect(run('italic', 'une *[soirée]* ici')).toBe('une [soirée] ici');
    expect(run('italic', 'une [*soirée*] ici')).toBe('une [soirée] ici');
  });

  it('do not take the bold marks for two italic ones, nor the other way', () => {
    // inside a bold word, italic adds its marks: `***mot***` is a bold italic word
    expect(run('italic', 'une **[soirée]** ici')).toBe('une ***[soirée]*** ici');
    // and a bold word that is also italic loses only the bold
    expect(run('bold', 'une ***[soirée]*** ici')).toBe('une *[soirée]* ici');
    expect(run('italic', 'une [**soirée**] ici')).toBe('une *[**soirée**]* ici');
  });

  it('work with a selection that spans several words', () => {
    expect(run('bold', '[le grand soir] arrive')).toBe('**[le grand soir]** arrive');
  });
});

describe('lists and headings', () => {
  it('put a bullet at the start of every line selected', () => {
    expect(run('bullets', 'a\n[b\nc]\nd')).toBe('a\n[- b\n- c]\nd');
    expect(run('bullets', 'one[ line ]only')).toBe('[- one line only]');
  });

  it('number the lines in order, from 1', () => {
    expect(run('numbers', '[un\ndeux\ntrois]')).toBe('[1. un\n2. deux\n3. trois]');
  });

  it('take the mark off when every line has it, and replace the other kind of list', () => {
    expect(run('bullets', '[- a\n- b]')).toBe('[a\nb]');
    expect(run('numbers', '[1. a\n2. b]')).toBe('[a\nb]');
    expect(run('numbers', '[- a\n- b]')).toBe('[1. a\n2. b]');
    expect(run('bullets', '[1. a\n2. b]')).toBe('[- a\n- b]');
    // some lines have it, some do not: it is put on all (a click that takes marks off would surprise)
    expect(run('bullets', '[- a\nb]')).toBe('[- a\n- b]');
  });

  it('leave empty lines alone and number only the lines that have text', () => {
    expect(run('numbers', '[a\n\nb]')).toBe('[1. a\n\n2. b]');
  });

  it('start a list where there is nothing, with a word to type', () => {
    expect(run('bullets', '[]')).toBe('- [élément]');
    expect(run('numbers', 'avant\n[]')).toBe('avant\n1. [élément]');
  });

  it('touch the lines the selection touches, not the one it ends at the start of', () => {
    expect(run('bullets', 'a\n[b\n]c')).toBe('a\n[- b]\nc');
  });

  it('make a heading, and take it off, and replace one of another size', () => {
    expect(run('heading', '[Le programme]')).toBe('[## Le programme]');
    expect(run('heading', '[## Le programme]')).toBe('[Le programme]');
    expect(run('heading', '[# Le programme]')).toBe('[## Le programme]');
    expect(run('heading', '[]')).toBe('## [Titre]');
  });

  it('turn a bullet into a heading and a heading into a bullet, never both at once', () => {
    expect(run('heading', '[- a]')).toBe('[## a]');
    expect(run('bullets', '[## a]')).toBe('[- a]');
  });

  it('do not take bold text for a bullet', () => {
    expect(run('bullets', '[**a** b]')).toBe('[- **a** b]');
  });
});

describe('links', () => {
  it('wrap the selection and select the address, to type it over', () => {
    // the selection is the address: `[le site](` + `[https://]` + `)`
    expect(run('link', 'voir [le site] ici')).toBe('voir [le site]([https://]) ici');
  });

  it('give a word and an address to type where nothing is selected', () => {
    expect(run('link', '[]')).toBe('[texte du lien]([https://])');
  });

  it('take a selected address for the address and ask for the words', () => {
    // the selection is the words of the link: `[` + `[texte du lien]` + `](address)`
    expect(run('link', 'voir [https://exemple.fr/a?b=1] ici')).toBe(
      'voir [[texte du lien]](https://exemple.fr/a?b=1) ici',
    );
  });

  it('is read as a link by the reader of the page', () => {
    const edit = applyFormat('link', 'x', 0, 1, WORDS)!;
    const filled = edit.text.replace('https://', 'https://exemple.fr');
    const [block] = parseMarkdown(filled);
    expect(block).toMatchObject({ type: 'paragraph' });
    expect(JSON.stringify(block)).toContain('"type":"link"');
  });
});

describe('what comes out is Markdown the reader draws as expected', () => {
  it.each([
    ['bold', '**', 'strong'],
    ['italic', '*', 'em'],
  ] as const)('%s', (format, _mark, node) => {
    const edit = applyFormat(format, 'un mot', 3, 6, WORDS)!;
    expect(JSON.stringify(parseMarkdown(edit.text))).toContain(`"type":"${node}"`);
  });

  it('lists and headings', () => {
    expect(parseMarkdown(applyFormat('bullets', 'a\nb', 0, 3, WORDS)!.text)[0]).toMatchObject({
      type: 'list',
      ordered: false,
    });
    expect(parseMarkdown(applyFormat('numbers', 'a\nb', 0, 3, WORDS)!.text)[0]).toMatchObject({
      type: 'list',
      ordered: true,
    });
    expect(parseMarkdown(applyFormat('heading', 'a', 0, 1, WORDS)!.text)[0]).toMatchObject({
      type: 'heading',
    });
  });
});

describe('the limit of the field', () => {
  it('refuses a change that would make the text longer than the field allows, and allows one that does not add', () => {
    expect(applyFormat('bold', 'abc', 0, 3, WORDS, 6)).toBeNull();
    expect(applyFormat('bold', 'abc', 0, 3, WORDS, 7)).toMatchObject({ text: '**abc**' });
    // taking marks off is always possible, even when the text is over the limit
    expect(applyFormat('bold', '**abc**', 2, 5, WORDS, 3)).toMatchObject({ text: 'abc' });
  });

  it('keeps a selection that is out of the text inside it', () => {
    expect(applyFormat('bold', 'abc', 10, 20, WORDS)).toMatchObject({
      text: 'abc**texte en gras**',
    });
    expect(applyFormat('bold', 'abc', 2, 1, WORDS)).toMatchObject({ text: 'a**b**c' });
  });
});

describe('the keyboard shortcuts', () => {
  const key = (key: string, over: Partial<Parameters<typeof shortcutFormat>[0]> = {}) =>
    shortcutFormat({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

  it('are Ctrl or Cmd + B and I, in either case', () => {
    expect(key('b')).toBe('bold');
    expect(key('B')).toBe('bold');
    expect(key('i')).toBe('italic');
    expect(key('b', { ctrlKey: false, metaKey: true })).toBe('bold');
  });

  it('leave every other key, and the same keys with Shift or Alt, to the browser', () => {
    expect(key('k')).toBeNull();
    expect(key('b', { shiftKey: true })).toBeNull();
    expect(key('b', { altKey: true })).toBeNull();
    expect(key('b', { ctrlKey: false })).toBeNull();
  });
});

describe('the difference between two texts', () => {
  it.each([
    ['abc', 'abc', { from: 3, to: 3, insert: '' }],
    ['abc', 'a**b**c', { from: 1, to: 2, insert: '**b**' }],
    ['a\nb', '- a\n- b', { from: 0, to: 2, insert: '- a\n- ' }],
    ['aaa', 'aaaa', { from: 3, to: 3, insert: 'a' }],
    ['', 'x', { from: 0, to: 0, insert: 'x' }],
    ['**ab**', 'ab', { from: 0, to: 6, insert: 'ab' }],
  ])('%j → %j', (before, after, expected) => {
    const found = difference(before, after);
    expect(before.slice(0, found.from) + found.insert + before.slice(found.to)).toBe(after);
    expect(found.insert.length).toBeLessThanOrEqual(after.length);
    if (before !== after) expect(found).toEqual(expected);
  });
});
