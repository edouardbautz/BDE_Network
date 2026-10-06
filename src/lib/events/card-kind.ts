import type { ReminderDay } from './messages';

/** What a card or an e-mail announces: a new confirmed event, or a reminder for today or tomorrow. */
export type EventCardKind = 'confirmed' | ReminderDay;

/** The message that names the kind, as the small line above the heading. */
export const KIND_LABEL_KEY: Record<EventCardKind, string> = {
  confirmed: 'embed.kind.confirmed',
  tomorrow: 'embed.kind.reminderTomorrow',
  today: 'embed.kind.reminderToday',
};
