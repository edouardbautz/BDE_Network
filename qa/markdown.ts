/**
 * Text as a cell of a Markdown table: a bar would end the cell, and a backslash in front of it would take its place in the
 * escape (`\|` read as an escaped backslash and then a bar), so both are escaped, the backslash first (one pass: neither is
 * made by the removal of the other).
 */
export function tableCell(text: string): string {
  return text.replace(/[\\|]/g, '\\$&');
}
