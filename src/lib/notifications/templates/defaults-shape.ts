import type { ItemId, TemplateChannel } from './types';

/**
 * The shape of what the platform says by itself (`defaults.ts`), and the part of it the browser needs: no server code here, the
 * editor imports this file.
 */

export interface ItemDefault {
  /** What the item is called where the channel shows a name. Absent for what has none (the description of an event). */
  label?: string;
  /** The emoji Discord puts in front of it; Slack and e-mail put none. */
  emoji?: string;
  /** The sentence of `summary`. */
  text?: string;
}

export interface ChannelDefaults {
  eyebrow: string;
  title: string;
  /** The emoji in front of the title: Discord's own for the kind of card; none for Slack and e-mail. */
  emoji: string;
  footer: string;
  /** The label of the button, and whether the channel has one when nothing is said. */
  button: { label: string; native: boolean };
  /** E-mail only. */
  subject?: string;
  note?: string;
  items: Partial<Record<ItemId, ItemDefault>>;
}

/**
 * What the platform says for "all channels": the words they have in common, and nothing where they differ (the footer, the emoji of
 * Discord, a button the channels do not all have). A change made for all channels then applies to each; what is left alone is each
 * channel's own.
 */
export function commonDefaults(
  channels: Partial<Record<TemplateChannel, ChannelDefaults>>,
): ChannelDefaults {
  const first = channels.discord ?? channels.slack ?? channels.email!;
  const items: ChannelDefaults['items'] = {};
  for (const [id, item] of Object.entries(first.items) as Array<[ItemId, ItemDefault]>) {
    items[id] = {
      ...(item.label !== undefined && { label: item.label }),
      ...(item.text !== undefined && { text: item.text }),
    };
  }
  return {
    eyebrow: first.eyebrow,
    title: first.title,
    emoji: '',
    footer: '',
    button: { label: (channels.slack ?? first).button.label, native: true },
    items,
  };
}
