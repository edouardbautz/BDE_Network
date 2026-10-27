import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationEvent,
} from '@/config/schema';
import type { NotificationMatrix } from './notifications';

/**
 * The table of the notifications, as the installer and the settings page draw it: the rules of what can be ticked and what the
 * shortcuts do, with no React in them (tested on their own, `notification-matrix.test.ts`). The server refuses what these rules
 * do not offer (`parseNotifications`): the page is a courtesy.
 */

/** The rows, in groups: what concerns the members, the backups (always: the owners are the ones told), the events (only when the module
 * is on) and their publication on the intra (only when the platform publishes there). */
export const MATRIX_GROUPS = {
  members: ['memberPending', 'memberApproved', 'memberRemoved'],
  backups: ['backupFailed', 'backupStale'],
  events: ['eventConfirmed', 'eventReminder', 'eventProposed', 'eventApproved', 'eventRefused'],
  intra: ['intraRequested', 'intraChanged', 'intraCancelled', 'intraPublished', 'intraRefused'],
} as const satisfies Record<string, readonly NotificationEvent[]>;

export type MatrixGroup = keyof typeof MATRIX_GROUPS;

/** The rows shown: the events ones only when the events module is on, those of the intra only when the platform publishes there
 * too (what they hold is kept, not shown). */
export const visibleRows = (events: boolean, intra = false): NotificationEvent[] => [
  ...MATRIX_GROUPS.members,
  ...MATRIX_GROUPS.backups,
  ...(events ? MATRIX_GROUPS.events : []),
  ...(events && intra ? MATRIX_GROUPS.intra : []),
];

/** Whether a box exists at all: nobody writes to a member who was just removed, so that one has no e-mail. */
export const isOffered = (event: NotificationEvent, channel: NotificationChannel): boolean =>
  !(event === 'memberRemoved' && channel === 'email');

export type Configured = Record<NotificationChannel, boolean>;

/** A box can be ticked: it exists and its channel is configured. */
export const isTickable = (
  event: NotificationEvent,
  channel: NotificationChannel,
  configured: Configured,
): boolean => isOffered(event, channel) && configured[channel];

const sorted = (channels: readonly NotificationChannel[]): NotificationChannel[] =>
  NOTIFICATION_CHANNELS.filter((channel) => channels.includes(channel));

/** One box ticked or not. */
export function setCell(
  matrix: NotificationMatrix,
  event: NotificationEvent,
  channel: NotificationChannel,
  on: boolean,
): NotificationMatrix {
  const channels = matrix[event].filter((existing) => existing !== channel);
  return { ...matrix, [event]: sorted(on ? [...channels, channel] : channels) };
}

/** Whether every box of a column that can be ticked is: `none` also for a column with nothing to tick. */
export function columnState(
  matrix: NotificationMatrix,
  channel: NotificationChannel,
  rows: readonly NotificationEvent[],
  configured: Configured,
): 'all' | 'some' | 'none' {
  const cells = rows.filter((event) => isTickable(event, channel, configured));
  const ticked = cells.filter((event) => matrix[event].includes(channel)).length;
  if (cells.length === 0 || ticked === 0) return 'none';
  return ticked === cells.length ? 'all' : 'some';
}

/** The shortcut of a column: ticks (or clears) every box of it that can be ticked, in the rows shown, and nothing else. */
export function setColumn(
  matrix: NotificationMatrix,
  channel: NotificationChannel,
  rows: readonly NotificationEvent[],
  configured: Configured,
  on: boolean,
): NotificationMatrix {
  let next = matrix;
  for (const event of rows) {
    if (isTickable(event, channel, configured)) next = setCell(next, event, channel, on);
  }
  return next;
}

/** Everything cleared, in the rows shown. */
export function clearRows(
  matrix: NotificationMatrix,
  rows: readonly NotificationEvent[],
): NotificationMatrix {
  const next = { ...matrix };
  for (const event of rows) next[event] = [];
  return next;
}

/** What is really ticked: the boxes of a channel that is not configured (removed, or never set up) are not. */
export function effectiveMatrix(
  matrix: NotificationMatrix,
  configured: Configured,
): NotificationMatrix {
  const next = { ...matrix };
  for (const event of Object.keys(matrix) as NotificationEvent[]) {
    next[event] = matrix[event].filter((channel) => isTickable(event, channel, configured));
  }
  return next;
}

/** How many types of notification go through a channel (for the summary of the installer). */
export function countFor(matrix: NotificationMatrix, channel: NotificationChannel): number {
  return (Object.keys(matrix) as NotificationEvent[]).filter((event) =>
    matrix[event].includes(channel),
  ).length;
}
