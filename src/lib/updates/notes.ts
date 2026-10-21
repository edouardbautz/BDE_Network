const MAX_SUMMARY = 320;

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
  const text = first
    .replace(/<[^>]*>/g, '')
    // One pass leaves a tag made by the removal itself (`<<b>script>`): what is left of the brackets goes too.
    .replace(/[<>]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_SUMMARY) return text;
  return `${text.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, '')}…`;
}
