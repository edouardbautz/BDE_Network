/**
 * The name a template uses for somebody it mentions (`{@role:bureau}`), made from the label the person gave them ("Le Bureau"):
 * lowercase, no accents, words joined by hyphens, at most 40 characters, and not one that is already taken for that platform.
 */
export function mentionKeyFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36)
      .replace(/-+$/g, '') || 'mention';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
