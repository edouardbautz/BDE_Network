/** The size of a backup as a person reads it: kilobytes below a megabyte, megabytes below a gigabyte (decimal, like the file managers). */
export function formatSize(bytes: number, locale: string): string {
  const [value, unit] =
    bytes < 1_000_000
      ? ([Math.max(1, Math.round(bytes / 1_000)), 'kilobyte'] as const)
      : bytes < 1_000_000_000
        ? ([bytes / 1_000_000, 'megabyte'] as const)
        : ([bytes / 1_000_000_000, 'gigabyte'] as const);
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 'kilobyte' ? 0 : 1,
  }).format(value);
}
