import { getConfig } from '@/config';

export interface CategoryView {
  key: string;
  label: string;
  /** Hex colour from bde.config.yml, or null for an unknown category. */
  color: string | null;
}

/** The categories defined by this BDE, in config order. */
export function getCategories(): CategoryView[] {
  return (getConfig().events?.categories ?? []).map(({ key, label, color }) => ({
    key,
    label,
    color,
  }));
}

/** Resolves a stored category key. A key that was later removed from the
 * config still displays (as its raw key, uncoloured) instead of breaking. */
export function resolveCategory(
  key: string,
  categories: readonly CategoryView[] = getCategories(),
): CategoryView {
  return categories.find((category) => category.key === key) ?? { key, label: key, color: null };
}
