import type { NotificationEvent } from '@/config/schema';
import type { MentionDirectory } from './mentions';

/**
 * The template of a notification: what a BDE changes of how a card, a Slack message or an e-mail looks.
 *
 * **A template is a set of changes on top of what the platform sends by itself.** Every field is optional and a field that is
 * absent means "as the platform does it for that channel" (its own title icon, its own order of facts, its own button
 * label…). So a template that says nothing renders exactly the notification as it has always been (`golden.test.ts` holds
 * that to the byte), a BDE only ever writes down what it wants different, and what it did not touch follows the platform
 * when a later version improves it.
 */

export type TemplateChannel = 'discord' | 'slack' | 'email';

export const TEMPLATE_CHANNELS = [
  'discord',
  'slack',
  'email',
] as const satisfies readonly TemplateChannel[];

/** The kind of notification a template is for: the keys of `notifications` in the configuration. */
export type TemplateType = NotificationEvent;

/**
 * What can be shown about a notification, one at a time. The set depends on the type (`catalog.ts`): an event has a place,
 * a member has a login.
 *
 * - `when`, `repeats`, `where`, `description`, `category`, `assignees`: the event.
 * - `proposedBy`, `reviewedBy`, `reason`: the proposal circuit (who proposed, who answered, why it was refused).
 * - `summary`: the sentence that says what happened to a member ("{name} is asking for access to the platform").
 * - `login`, `campus`, `role`, `actedBy`: the member (`actedBy` is who approved or removed them).
 */
export type ItemId =
  | 'when'
  | 'repeats'
  | 'where'
  | 'description'
  | 'category'
  | 'assignees'
  | 'proposedBy'
  | 'reviewedBy'
  | 'reason'
  | 'summary'
  | 'login'
  | 'campus'
  | 'role'
  | 'actedBy';

/** A line of free text the BDE adds to a notification: the id is `text:` and a short key of its own. */
export type CustomItemId = `text:${string}`;

export interface TemplateItem {
  id: ItemId | CustomItemId;
  /** An item that is switched off stays in the list (its label and emoji are kept) and is not shown. */
  enabled: boolean;
  /** What the item is called, where the channel shows a name (a field, a column, a row). Absent: the platform's word. */
  label?: string;
  /** An emoji in front of the item. Absent: the channel's own (Discord has one for each fact, Slack and e-mail none); `''`: none. */
  emoji?: string;
  /** The text of a free-text item, or the sentence of `summary`. May hold variables and a little formatting. */
  text?: string;
}

export interface TemplateItems {
  /** `native`: every channel keeps its own order of facts; `custom`: the order of `list`, within what each channel can order. */
  order: 'native' | 'custom';
  /** Exactly the items shown or switched off: an item of the type that is not in the list is not shown. */
  list: TemplateItem[];
}

export interface TemplateContent {
  /** The small line above the title ("New event confirmed"). May hold variables. */
  eyebrow?: string;
  /** The title (`{title}`). May hold variables. */
  title?: string;
  /** The emoji in front of the title. Absent: the channel's own (Discord has one for each kind of card); `''`: none. */
  emoji?: string;
  /** The colour of the bar, `#rrggbb`. Absent: automatic (the category's for an event, the kind's for a member). */
  color?: string;
  items?: TemplateItems;
  button?: {
    /** Absent: as the channel does (a button in Slack and e-mail, a link in a Discord card for a member). */
    enabled?: boolean;
    /** Absent: the platform's label for that channel. */
    label?: string;
    /** Where the button leads: an `https` address of the BDE's choosing. Absent: the page of the notification (the event, the members). */
    url?: string;
  };
  /**
   * Discord and Slack only: a message above the card, the one place a mention is read (`mentions.ts`). May hold variables and
   * `{@everyone}`, `{@here}`, `{@channel}` (Slack), `{@role:bureau}`, `{@user:paula}`, `{@group:bureau}`. Absent: nothing above the card.
   */
  above?: string;
  /** The footer line. Absent: the platform's own. */
  footer?: string;
  /** E-mail only: the subject. May hold variables. */
  subject?: string;
  /** E-mail only: the line the inbox shows after the subject. Absent: built from the kind, the date and the place. */
  preheader?: string;
  /** E-mail only: the small sentence under the button. Absent: the platform's (the note about the calendar file). */
  note?: string;
}

/** What `renderTemplate` needs besides the template: the values the variables stand for, and the name of the BDE. */
export interface TemplateContext {
  template?: TemplateContent;
  /** The name of the BDE, for `{bde}`. */
  bdeName?: string;
  /** The language the dates of the variables are written in: the BDE's. */
  locale?: string;
  /** The people, roles and groups the BDE can mention, by the name its templates use. */
  mentions?: MentionDirectory;
}
