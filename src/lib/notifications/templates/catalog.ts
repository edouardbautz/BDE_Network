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
  memberPending: ['summary', 'login', 'campus'],
  memberApproved: ['summary', 'login', 'campus', 'role', 'actedBy'],
  memberRemoved: ['summary', 'login', 'campus', 'role', 'actedBy'],
};

/**
 * The order each channel shows the items of a type in when nothing is chosen: what the cards, messages and e-mails have
 * always done (they differ: Discord leads with the date and the place, Slack with the description, an e-mail lists the
 * facts in a table). An item that a channel does not show for a type is not in its list.
 */
const EVENT_NATIVE: Record<TemplateChannel, readonly ItemId[]> = {
  discord: [
    'reason',
    'when',
    'where',
    'description',
    'category',
    'proposedBy',
    'reviewedBy',
    'assignees',
    'repeats',
  ],
  slack: [
    'reason',
    'description',
    'when',
    'where',
    'category',
    'proposedBy',
    'reviewedBy',
    'assignees',
    'repeats',
  ],
  email: [
    'reason',
    'description',
    'when',
    'repeats',
    'where',
    'category',
    'assignees',
    'proposedBy',
    'reviewedBy',
  ],
};

const MEMBER_NATIVE: Record<TemplateChannel, readonly ItemId[]> = {
  discord: ['login', 'campus', 'summary', 'role', 'actedBy'],
  slack: ['summary', 'login', 'campus', 'role', 'actedBy'],
  email: ['summary', 'login', 'campus', 'role', 'actedBy'],
};

/** What a channel shows of the items of a type: its own order, restricted to what the type has and the channel shows. */
export function nativeOrder(channel: TemplateChannel, type: TemplateType): ItemId[] {
  const own = type.startsWith('event') ? EVENT_NATIVE[channel] : MEMBER_NATIVE[channel];
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
  memberPending: ['name', 'login', 'campus', 'bde', 'link'],
  memberApproved: ['name', 'login', 'campus', 'role', 'actor', 'bde', 'link'],
  memberRemoved: ['name', 'login', 'campus', 'role', 'actor', 'bde'],
} as const satisfies Record<TemplateType, readonly string[]>;

export type VariableId = (typeof VARIABLES)[TemplateType][number];

export function variablesOf(type: TemplateType): readonly string[] {
  return VARIABLES[type];
}
