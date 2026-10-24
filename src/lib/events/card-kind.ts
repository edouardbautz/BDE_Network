import type { ReminderDay } from './messages';

/**
 * What a card or an e-mail announces: a new confirmed event, a reminder for today or tomorrow, a step of the
 * proposal circuit (an event proposed for validation, approved, refused), or a step of its publication on the intra: the staff is
 * asked (`intraRequested`), told that an event on the intra changed (`intraChanged`) or was taken back (`intraCancelled`), and the
 * author that it was published or refused. `test` is the sample the settings page and the installer send to see a channel work: the
 * same cards and e-mail, with an invented event.
 */
export type EventCardKind =
  'confirmed' | ReminderDay | 'proposed' | 'approved' | 'refused' | IntraCardKind | 'test';

export const INTRA_CARD_KINDS = [
  'intraRequested',
  'intraChanged',
  'intraCancelled',
  'intraPublished',
  'intraRefused',
] as const;
export type IntraCardKind = (typeof INTRA_CARD_KINDS)[number];

export const isIntraKind = (kind: EventCardKind): kind is IntraCardKind =>
  (INTRA_CARD_KINDS as readonly string[]).includes(kind);

/** The messages that speak to the school's staff: they lead to the staff's page, not to the event (which the staff may not open). */
export const STAFF_KINDS: readonly EventCardKind[] = [
  'intraRequested',
  'intraChanged',
  'intraCancelled',
];

/** The message that names the kind, as the small line above the heading. */
export const KIND_LABEL_KEY: Record<EventCardKind, string> = {
  confirmed: 'embed.kind.confirmed',
  tomorrow: 'embed.kind.reminderTomorrow',
  today: 'embed.kind.reminderToday',
  proposed: 'embed.kind.proposed',
  approved: 'embed.kind.approved',
  refused: 'embed.kind.refused',
  intraRequested: 'embed.kind.intraRequested',
  intraChanged: 'embed.kind.intraChanged',
  intraCancelled: 'embed.kind.intraCancelled',
  intraPublished: 'embed.kind.intraPublished',
  intraRefused: 'embed.kind.intraRefused',
  test: 'embed.kind.test',
};

/** The label of the button of an e-mail (`email.…`) or a Slack message (`slack.…`): a proposal asks to be
 * examined, what is for the staff opens the platform's page, the rest only shows the event. */
export function actionLabelKey(kind: EventCardKind, channel: 'email' | 'slack'): string {
  if (STAFF_KINDS.includes(kind)) return `${channel}.staffAction`;
  return kind === 'proposed' ? `${channel}.reviewAction` : `${channel}.action`;
}
