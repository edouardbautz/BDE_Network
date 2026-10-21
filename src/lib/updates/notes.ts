const MAX_SUMMARY = 320;

/**
 * The text without anything between a `<` and the next `>`, read once, character by character: no bracket opens a tag that the
 * removal of another one would have made (`<<b>script>` leaves `script`, and an unclosed `<` takes the rest with it).
 */
function withoutTags(text: string): string {
  let kept = '';
  let inTag = false;
  for (const character of text) {
    if (character === '<') inTag = true;
    else if (character === '>') inTag = false;
    else if (!inTag) kept += character;
  }
  return kept;
}

/**
 * The few sentences of a release's notes that tell what it is about, as plain text: the first paragraph that is
 * not a heading or a list, without its Markdown. The notes come from the network: they are never trusted as markup
 * (the page shows this as text), and only a short piece of them is kept.
 */
export function summarizeNotes(body: string): string {
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '' && !/^(#|[-*+] |\d+\. |>|---|```|\|)/.test(paragraph));
  const first = paragraphs[0];
  if (!first) return '';
  const text = withoutTags(first)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_SUMMARY) return text;
  return `${text.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, '')}…`;
}
