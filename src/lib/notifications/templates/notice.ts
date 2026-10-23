/** What the page of the templates says in words after an action that loaded it again (`?notice=`). */
export const NOTICES = ['customised', 'reset', 'resetAll', 'restored', 'acknowledged'] as const;
export type Notice = (typeof NOTICES)[number];

/** The notice an address asks for, if it is one of ours. */
export function readNotice(value: string | string[] | undefined): Notice | null {
  const one = Array.isArray(value) ? value[0] : value;
  return NOTICES.find((notice) => notice === one) ?? null;
}
