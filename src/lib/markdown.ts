// A small Markdown reader for the description of an event: the part of Markdown that formatting a description needs, turned into a
// tree that a component draws as elements. It never produces HTML: what a member typed (a tag, a script, an address that
// is not http, https or mailto) stays text or is dropped, whatever it contains. That is why it is not a library: the
// platform needs a preview that cannot be turned against it, and a few kilobytes less to send to the browser.
//
// Supported: headings (#), paragraphs, bold (** or __), italic (* or _), code (`), links, bulleted and numbered lists (one
// level), quotes (>), fenced code (```) and a rule (---). A line break inside a paragraph is kept (what the description
// has always shown). Anything else is shown as typed.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

/** Longer than any description (5000 characters is the limit): the reader never works on more. */
const MAX_LENGTH = 20_000;
const MAX_DEPTH = 4;

/** The addresses a link may have: nothing that runs (`javascript:`) or carries data (`data:`). */
export function safeHref(value: string): string | null {
  const href = value.trim();
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** The index of the closing delimiter of an emphasis opened at `from` (after the opening one), or -1. */
function closing(text: string, delimiter: string, from: number): number {
  let index = text.indexOf(delimiter, from);
  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + delimiter.length];
    const intraword = delimiter[0] === '_' && isWord(after);
    if (before !== undefined && !/\s/.test(before) && before !== '\\' && !intraword) return index;
    index = text.indexOf(delimiter, index + 1);
  }
  return -1;
}

function pushText(parts: Inline[], text: string) {
  if (text === '') return;
  const last = parts[parts.length - 1];
  if (last && last.type === 'text') last.text += text;
  else parts.push({ type: 'text', text });
}

export function parseInline(text: string, depth = 0): Inline[] {
  const parts: Inline[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;

    if (char === '\\' && i + 1 < text.length && /[\\`*_[\]()#>!-]/.test(text[i + 1]!)) {
      pushText(parts, text[i + 1]!);
      i += 2;
      continue;
    }

    if (char === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        parts.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if ((char === '*' || char === '_') && depth < MAX_DEPTH) {
      const double = text[i + 1] === char;
      const delimiter = double ? char + char : char;
      const opensWord = char === '_' && isWord(text[i - 1]);
      const next = text[i + delimiter.length];
      if (!opensWord && next !== undefined && !/\s/.test(next)) {
        const end = closing(text, delimiter, i + delimiter.length);
        if (end > i + delimiter.length) {
          const children = parseInline(text.slice(i + delimiter.length, end), depth + 1);
          parts.push({ type: double ? 'strong' : 'em', children });
          i = end + delimiter.length;
          continue;
        }
      }
    }

    // An image is shown as its description: the platform never loads a picture an author pointed at.
    const image = char === '!' && text[i + 1] === '[';
    if ((char === '[' || image) && depth < MAX_DEPTH) {
      const open = image ? i + 1 : i;
      const mid = text.indexOf('](', open);
      const end = mid === -1 ? -1 : text.indexOf(')', mid + 2);
      if (mid > open + 0 && end !== -1 && !text.slice(open + 1, mid).includes('\n')) {
        const label = text.slice(open + 1, mid);
        const href = safeHref(text.slice(mid + 2, end));
        if (image) {
          pushText(parts, label);
          i = end + 1;
          continue;
        }
        if (href) {
          parts.push({ type: 'link', href, children: parseInline(label, depth + 1) });
          i = end + 1;
          continue;
        }
      }
    }

    pushText(parts, char);
    i += 1;
  }
  return parts;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}```/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

export function parseMarkdown(source: string, depth = 0): Block[] {
  const lines = source.slice(0, MAX_LENGTH).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraph.map((line) => parseInline(line.trim())) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (FENCE.test(line)) {
      endParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        code.push(lines[index]!);
        index += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      endParagraph();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]!),
      });
      continue;
    }
    if (RULE.test(line)) {
      endParagraph();
      blocks.push({ type: 'rule' });
      continue;
    }
    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      endParagraph();
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        quoted.push(QUOTE.exec(lines[index]!)![1]!);
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'quote', blocks: parseMarkdown(quoted.join('\n'), depth + 1) });
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      endParagraph();
      const items: Inline[][] = [];
      const pattern = ordered ? NUMBERED : BULLET;
      while (index < lines.length && pattern.test(lines[index]!)) {
        items.push(parseInline(pattern.exec(lines[index]!)![1]!.trim()));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    paragraph.push(line);
  }
  endParagraph();
  return blocks;
}
