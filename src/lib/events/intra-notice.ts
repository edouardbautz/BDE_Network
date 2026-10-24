import type { IntraNotice } from './intra-sync';

/**
 * The message an answer leaves at the top of the pages about the intra when it was not taken (somebody answered first, the event
 * changed while the page was open...). It travels in the address as `?notice=...`; anything not in this list is ignored, never echoed.
 * Like `EVENT_NOTICES`, which the event page reads.
 */
export const INTRA_NOTICES = [
  'gone',
  'alreadyAnswered',
  'changedMeanwhile',
  'notPublishable',
  'alreadyRequested',
  'busy',
] as const satisfies readonly (IntraNotice | 'busy')[];

export type IntraPageNotice = (typeof INTRA_NOTICES)[number];

export function readIntraNotice(value: string | string[] | undefined): IntraPageNotice | null {
  const notice = Array.isArray(value) ? value[0] : value;
  return INTRA_NOTICES.find((known) => known === notice) ?? null;
}
