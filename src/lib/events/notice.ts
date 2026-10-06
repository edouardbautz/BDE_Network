/**
 * A short message shown at the top of an events page after an action found that what it was
 * asked to change is gone (deleted by someone else in the meantime, a date of a series that
 * was edited). It travels in the URL as `?notice=...`; anything not in this list is ignored,
 * never echoed.
 */
export const EVENT_NOTICES = ['eventGone', 'occurrenceGone'] as const;

export type EventNotice = (typeof EVENT_NOTICES)[number];

export function readEventNotice(value: string | string[] | undefined): EventNotice | null {
  const notice = Array.isArray(value) ? value[0] : value;
  return EVENT_NOTICES.find((known) => known === notice) ?? null;
}
