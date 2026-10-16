import { expandRepeat, type Occurrence, type RecurringSource } from './repeat';

export { MAX_OCCURRENCES } from './repeat';
export type { Occurrence, RecurringSource } from './repeat';

/**
 * Every date of an event, computed on the wall clock of `timeZone` (see `expandRepeat` and "Repeat rules" in
 * docs/architecture.md): an event that does not repeat has one.
 */
export function allOccurrences(source: RecurringSource, timeZone: string): Occurrence[] {
  return expandRepeat(source, timeZone).occurrences;
}

/** Occurrences overlapping [from, to), with cancelled ones removed. */
export function occurrencesInRange(
  source: RecurringSource,
  timeZone: string,
  range: { from: Date; to: Date },
  cancelledStarts: ReadonlySet<number> = new Set(),
): Occurrence[] {
  return allOccurrences(source, timeZone).filter(
    (occurrence) =>
      !cancelledStarts.has(occurrence.start.getTime()) &&
      occurrence.end.getTime() > range.from.getTime() &&
      occurrence.start.getTime() < range.to.getTime(),
  );
}

/** True if `start` is exactly one of the series' occurrence starts. */
export function isOccurrenceStart(source: RecurringSource, timeZone: string, start: Date): boolean {
  return allOccurrences(source, timeZone).some(
    (occurrence) => occurrence.start.getTime() === start.getTime(),
  );
}
