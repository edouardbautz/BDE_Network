/** Lower-cases and strips accents, so "Montréal" is found by "montreal". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The campuses whose name contains `query` (accents and case ignored), best matches first. */
export function searchCampuses<T extends { name: string }>(
  campuses: readonly T[],
  query: string,
): T[] {
  const needle = fold(query);
  if (!needle) return [];
  return campuses
    .filter((campus) => fold(campus.name).includes(needle))
    .sort((a, b) => {
      const aStarts = fold(a.name).startsWith(needle) ? 0 : 1;
      const bStarts = fold(b.name).startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    });
}
