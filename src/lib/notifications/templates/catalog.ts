import type { ItemId, TemplateChannel, TemplateType } from './types';

/**
 * What each type of notification can show and say, and in which order each channel shows it when the BDE has not chosen.
 * This is the one place that knows it: the builders read their order from here, the editor offers what is here, and the
 * validation refuses what is not.
 */

const EVENT_BASE: ItemId[] = ['when', 'repeats', 'where', 'description', 'category', 'assignees'];

/** The items of each type, in the order the editor lists them. */
export const ITEMS: Record<TemplateType, readonly ItemId[]> = {
  eventConfirmed: EVENT_BASE,
  eventReminder: EVENT_BASE,
  eventProposed: [...EVENT_BASE, 'proposedBy'],
  eventApproved: [...EVENT_BASE, 'proposedBy', 'reviewedBy'],
  eventRefused: ['reason', ...EVENT_BASE, 'proposedBy', 'reviewedBy'],
  // Publishing on the intra: the staff is asked (with the fields of the intra's form), told what changed or that it was taken back, and
  // the author is told it was published or refused. A category and the members in charge mean nothing to the staff.
  intraRequested: ['when', 'repeats', 'where', 'description', 'intraFields', 'requestedBy'],
  intraChanged: ['changes', 'when', 'repeats', 'where', 'actedBy'],
  intraCancelled: ['reason', 'when', 'repeats', 'where', 'actedBy'],
  intraPublished: ['when', 'repeats', 'where', 'intraLink', 'actedBy'],
  intraRefused: ['reason', 'when', 'repeats', 'where', 'actedBy'],
  memberPending: ['summary', 'login', 'campus'],
  memberApproved: ['summary', 'login', 'campus', 'role', 'actedBy'],
  memberRemoved: ['summary', 'login', 'campus', 'role', 'actedBy'],
  // The backups (after the members, so that the editor opens on the first of them when no module is on): the owners are told that the nightly backup failed, or that none has succeeded for two days.
  backupFailed: ['summary', 'failure', 'lastBackup'],
  backupStale: ['summary', 'failure', 'lastBackup'],
};

/**
 * The order each channel shows the items of a type in when nothing is chosen: what the cards, messages and e-mails have
 * always done (they differ: Discord leads with the date and the place, Slack with the description, an e-mail lists the
 * facts in a table). An item that a channel does not show for a type is not in its list.
 */
const EVENT_NATIVE: Record<TemplateChannel, readonly ItemId[]> = {
  discord: [
    'reason',
    'changes',
    'when',
    'where',
    'description',
    'intraFields',
    'category',
    'proposedBy',
    'reviewedBy',
    'requestedBy',
    'actedBy',
    'assignees',
    'repeats',
    'intraLink',
  ],
  slack: [
    'reason',
    'changes',
    'description',
    'when',
    'where',
    'intraFields',
    'category',
    'proposedBy',
    'reviewedBy',
    'requestedBy',
    'actedBy',
    'assignees',
    'repeats',
    'intraLink',
  ],
  email: [
    'reason',
    'changes',
    'description',
    'when',
    'repeats',
    'where',
    'intraFields',
    'category',
    'assignees',
    'proposedBy',
    'reviewedBy',
    'requestedBy',
    'actedBy',
    'intraLink',
  ],
};

const MEMBER_NATIVE: Record<TemplateChannel, readonly ItemId[]> = {
  discord: ['login', 'campus', 'summary', 'role', 'actedBy'],
  slack: ['summary', 'login', 'campus', 'role', 'actedBy'],
  email: ['summary', 'login', 'campus', 'role', 'actedBy'],
};

/** The same order on the three channels: the sentence, why, and the last good backup. */
const BACKUP_NATIVE: Record<TemplateChannel, readonly ItemId[]> = {
  discord: ['summary', 'failure', 'lastBackup'],
  slack: ['summary', 'failure', 'lastBackup'],
  email: ['summary', 'failure', 'lastBackup'],
};

/** What a channel shows of the items of a type: its own order, restricted to what the type has and the channel shows. */
export function nativeOrder(channel: TemplateChannel, type: TemplateType): ItemId[] {
  const own = type.startsWith('backup')
    ? BACKUP_NATIVE[channel]
    : type.startsWith('event') || type.startsWith('intra')
      ? EVENT_NATIVE[channel]
      : MEMBER_NATIVE[channel];
  const known = new Set<ItemId>(ITEMS[type]);
  const order = own.filter((id) => known.has(id));
  // The e-mail to the approved member is about their own access: the sentence and their role, nothing else.
  if (channel === 'email' && type === 'memberApproved') {
    return order.filter((id) => id === 'summary' || id === 'role');
  }
  return order;
}

/**
 * The channels a type is sent on at all. Nobody writes to a member who was removed, so the e-mail has no template for it.
 */
export function channelsOfType(type: TemplateType): readonly TemplateChannel[] {
  return type === 'memberRemoved' ? ['discord', 'slack'] : ['discord', 'slack', 'email'];
}

/**
 * The channels a template shared by all of them applies to. The e-mail of an approved member speaks to that person while the
 * chat channels inform the team: it is its own message and the shared template does not reach it.
 */
export function sharedChannels(type: TemplateType): readonly TemplateChannel[] {
  return type === 'memberApproved' ? ['discord', 'slack'] : channelsOfType(type);
}

/** The variables a text of a type may hold, as `{id}`. The editor lists them, the validation refuses any other. */
const EVENT_VARIABLES = [
  'title',
  'date',
  'time',
  'end_time',
  'when',
  'place',
  'category',
  'assignees',
  'repeat',
  'description',
  'link',
  'bde',
] as const;

export const VARIABLES = {
  eventConfirmed: EVENT_VARIABLES,
  eventReminder: [...EVENT_VARIABLES, 'day'],
  eventProposed: [...EVENT_VARIABLES, 'author'],
  eventApproved: [...EVENT_VARIABLES, 'author', 'reviewer'],
  eventRefused: [...EVENT_VARIABLES, 'author', 'reviewer', 'comment'],
  intraRequested: [...EVENT_VARIABLES, 'requester'],
  intraChanged: [...EVENT_VARIABLES, 'editor'],
  intraCancelled: [...EVENT_VARIABLES, 'editor', 'cause'],
  intraPublished: [...EVENT_VARIABLES, 'answerer', 'intra_link'],
  intraRefused: [...EVENT_VARIABLES, 'answerer', 'comment'],
  memberPending: ['name', 'login', 'campus', 'bde', 'link'],
  memberApproved: ['name', 'login', 'campus', 'role', 'actor', 'bde', 'link'],
  memberRemoved: ['name', 'login', 'campus', 'role', 'actor', 'bde'],
  backupFailed: ['reason', 'last', 'bde', 'link'],
  backupStale: ['days', 'last', 'reason', 'bde', 'link'],
} as const satisfies Record<TemplateType, readonly string[]>;

export type VariableId = (typeof VARIABLES)[TemplateType][number];
