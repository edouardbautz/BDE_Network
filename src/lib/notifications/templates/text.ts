/**
 * The text of a template: words, `{variables}` the notification replaces by what it is about, and (in the free texts only) a
 * little formatting, `**bold**` and `_italic_`, written the same for every channel and turned into each channel's own markup.
 *
 * What is typed in the template is the only thing that is ever read as a variable or as formatting. What the variables stand
 * for (a title, a place, a name) comes from members and is put in as plain text, whatever it holds: `{title}` stays a title
 * even when the title is `**hi** {place}`.
 */

export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** A piece of a source text: what was typed, or what a variable stood for. */
type Piece = { kind: 'literal'; text: string } | { kind: 'value'; text: string };

const TOKEN = /\{\{|\}\}|\{([a-z][a-z0-9_]*)\}/g;

/** The variables written in a text, in order of appearance (a doubled brace is a brace, not a variable). */
export function variablesIn(source: string): string[] {
  return [...source.matchAll(TOKEN)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function pieces(source: string, values: Readonly<Record<string, string>>): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'literal', text: source.slice(last, index) });
    if (match[1]) out.push({ kind: 'value', text: values[match[1]] ?? '' });
    else out.push({ kind: 'literal', text: match[0] === '{{' ? '{' : '}' });
    last = index + match[0].length;
  }
  if (last < source.length) out.push({ kind: 'literal', text: source.slice(last) });
  return out;
}

/** A text with its variables replaced and nothing else interpreted: a title, a label, a footer, a subject. */
export function renderPlain(source: string, values: Readonly<Record<string, string>>): string {
  return pieces(source, values)
    .map((piece) => piece.text)
    .join('');
}

const WORD = /[\p{L}\p{N}]/u;

/** Where the formatting markers of the literal pieces are: `**`, and `_` when it is not inside a word (`snake_case` is not italic). */
function markers(parts: Piece[]): Array<{ piece: number; at: number; kind: 'bold' | 'italic' }> {
  const found: Array<{ piece: number; at: number; kind: 'bold' | 'italic' }> = [];
  parts.forEach((part, piece) => {
    if (part.kind !== 'literal') return;
    const text = part.text;
    for (let at = 0; at < text.length; at += 1) {
      if (text.startsWith('**', at)) {
        found.push({ piece, at, kind: 'bold' });
        at += 1;
      } else if (text[at] === '_') {
        const before = at > 0 ? text[at - 1]! : '';
        const after = at + 1 < text.length ? text[at + 1]! : '';
        const insideWord = WORD.test(before) && WORD.test(after);
        if (!insideWord) found.push({ piece, at, kind: 'italic' });
      }
    }
  });
  return found;
}

/** One line of source, with its formatting. */
function renderLine(source: string, values: Readonly<Record<string, string>>): Segment[] {
  const parts = pieces(source, values);
  const all = markers(parts);
  const active = new Set<string>();
  for (const kind of ['bold', 'italic'] as const) {
    const ofKind = all.filter((marker) => marker.kind === kind);
    if (ofKind.length % 2 === 0) {
      for (const marker of ofKind) active.add(`${marker.piece}:${marker.at}`);
    }
  }

  const segments: Segment[] = [];
  let bold = false;
  let italic = false;
  const push = (text: string) => {
    if (text === '') return;
    const last = segments[segments.length - 1];
    if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) last.text += text;
    else segments.push({ text, ...(bold && { bold }), ...(italic && { italic }) });
  };

  parts.forEach((part, piece) => {
    if (part.kind === 'value') {
      push(part.text);
      return;
    }
    let from = 0;
    const text = part.text;
    for (let at = 0; at < text.length; at += 1) {
      if (!active.has(`${piece}:${at}`)) continue;
      push(text.slice(from, at));
      if (text.startsWith('**', at)) {
        bold = !bold;
        at += 1;
      } else {
        italic = !italic;
      }
      from = at + 1;
    }
    push(text.slice(from));
  });
  return segments;
}

/**
 * The text as pieces with their formatting. A marker only counts when it has its partner on the same line: `**` twice, `_`
 * twice (an odd one stays as typed).
 */
export function renderSegments(
  source: string,
  values: Readonly<Record<string, string>>,
): Segment[] {
  const out: Segment[] = [];
  source.split('\n').forEach((line, index) => {
    if (index > 0) out.push({ text: '\n' });
    out.push(...renderLine(line, values));
  });
  return out;
}

/** `**bold**` for Discord with the spaces outside the markers (a marker next to a space is not read as formatting). */
function wrap(text: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return match[2] === '' ? text : `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function format(segments: readonly Segment[], bold: string, italic: string): string {
  return segments
    .map((segment) => {
      let text = segment.text;
      if (segment.italic) text = wrap(text, italic);
      if (segment.bold) text = wrap(text, bold);
      return text;
    })
    .join('');
}

export const toDiscord = (segments: readonly Segment[]) => format(segments, '**', '_');
export const toSlack = (segments: readonly Segment[]) => format(segments, '*', '_');
export const toPlainText = (segments: readonly Segment[]) =>
  segments.map((segment) => segment.text).join('');
