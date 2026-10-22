/** An address as a kind of page: the identifiers become `:id`, the values of the query go (its names stay). */
export function patternOf(path: string, search: string): string {
  const names = [...new URLSearchParams(search).keys()].sort();
  const shape = path
    .replace(/\/events\/(?!new\b|review\b|shared-calendar\b)[^/]+/, '/events/:id')
    .replace(/\/roles\/(?!new\b)[^/]+/, '/roles/:id');
  return names.length > 0 ? `${shape}?${names.join('&')}` : shape;
}
