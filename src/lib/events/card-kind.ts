import type { ReminderDay } from './messages';

/**
 * What a card or an e-mail announces: a new confirmed event, a reminder for today or tomorrow, or a step of the
 * proposal circuit (an event proposed for validation, approved, refused).
 */
export type EventCardKind = 'confirmed' | ReminderDay | 'proposed' | 'approved' | 'refused';

/** The message that names the kind, as the small line above the heading. */
export const KIND_LABEL_KEY: Record<EventCardKind, string> = {
  confirmed: 'embed.kind.confirmed',
  tomorrow: 'embed.kind.reminderTomorrow',
  today: 'embed.kind.reminderToday',
  proposed: 'embed.kind.proposed',
  approved: 'embed.kind.approved',
  refused: 'embed.kind.refused',
};

/** The label of the button of an e-mail (`email.…`) or a Slack message (`slack.…`): a proposal asks to be
 * examined, the rest only to see the event. */
export function actionLabelKey(kind: EventCardKind, channel: 'email' | 'slack'): string {
  return kind === 'proposed' ? `${channel}.reviewAction` : `${channel}.action`;
}
