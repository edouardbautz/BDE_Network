/** The small statistics of the measures: the median and the 95th percentile are what is compared, never an average. */

export interface Spread {
  n: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

/** The value under which `p` percent of the sorted values fall (nearest rank: no value is invented between two measures). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('no value to take a percentile of');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error('no value to take a median of');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function spread(values: readonly number[]): Spread {
  return {
    n: values.length,
    median: median(values),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const kib = (bytes: number): number => round(bytes / 1024, 1);
export const mib = (bytes: number): number => round(bytes / 1024 / 1024, 1);
