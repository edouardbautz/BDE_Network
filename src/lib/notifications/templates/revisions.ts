import type { ItemId, TemplateType } from './types';

/**
 * The revision of the platform's own notification, for each type: raised when a version changes what the platform sends by
 * itself in a way a BDE that customised it should hear about (a new fact a card can show, a new variable, a rewording).
 *
 * A template a BDE saved records the revision it was written over (`NotificationTemplate.basedOnRevision`). **What the BDE wrote
 * is never replaced**; when the platform's revision is newer, the editor says so and lists what changed
 * (`REVISION_CHANGES`), and the BDE decides: keep its template, add what is new, or start again from the new default. A
 * notification the BDE did not customise has no template to keep and simply follows the platform.
 *
 * The rule that makes this safe: a variable is never removed and an item never changes meaning in a minor version, so a
 * template written for revision 1 stays valid for every later one.
 */
export const REVISIONS: Readonly<Record<TemplateType, number>> = {
  eventConfirmed: 1,
  eventReminder: 1,
  eventProposed: 1,
  eventApproved: 1,
  eventRefused: 1,
  memberPending: 1,
  memberApproved: 1,
  memberRemoved: 1,
};

export interface RevisionChange {
  /** The revision this change came with. */
  revision: number;
  /** The types it concerns. */
  types: readonly TemplateType[];
  /** The facts it adds to what a notification can show: offered in "Add information", never added to a template by themselves. */
  addedItems?: readonly ItemId[];
  /** The variables it adds. */
  addedVariables?: readonly string[];
  /** The key of what changed, written in `templates.revisions.<key>` of the messages, in both languages. */
  note: string;
}

/** What each revision changed, newest last. Revision 1 is the platform's notifications as they were when templates came. */
export const REVISION_CHANGES: readonly RevisionChange[] = [];

/** What changed for a type since the revision a template was written over. */
export function changesSince(type: TemplateType, basedOnRevision: number): RevisionChange[] {
  return REVISION_CHANGES.filter(
    (change) => change.revision > basedOnRevision && change.types.includes(type),
  );
}

/** Whether the platform's own notification has moved since a template was written. */
export function isOutdated(type: TemplateType, basedOnRevision: number): boolean {
  return REVISIONS[type] > basedOnRevision;
}
