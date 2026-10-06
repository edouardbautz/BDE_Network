/**
 * Discord "embeds": the coloured cards the platform posts in the BDE's channel. This file holds
 * what is Discord-specific and shared by every notification: the shape of an embed, colours,
 * the date markup Discord renders in each reader's own time zone, and the size limits that make
 * Discord reject a message when they are exceeded (so text is cut cleanly before it gets there).
 * What each notification says lives next to it (events/discord-embed.ts, members/discord-embed.ts).
 */

import { truncate } from './text';

export interface DiscordEmbedField {
  name: string;
  value: string;
  /** Fields marked inline sit side by side, up to three per row. */
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  /** Makes the title a link. An embed does not unfurl it into a second preview card. */
  url?: string;
  /** Colour of the bar at the left of the card, as the decimal number Discord expects. */
  color?: number;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
  footer?: { text: string };
  /** ISO 8601: Discord shows it, in the reader's time zone, next to the footer. */
  timestamp?: string;
}

/** What is posted to the webhook: the cards, and who they appear to come from. */
export interface DiscordPayload {
  embeds: DiscordEmbed[];
  /** The sender's name (the BDE's), overriding the webhook's own. */
  username?: string;
  /** The sender's picture: a public PNG, JPEG, GIF or WebP, never an SVG. */
  avatarUrl?: string;
}

/** Discord's documented limits for an embed. */
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
  /** Sum of every text of the embed (title, description, field names and values, footer). */
  total: 6000,
  username: 80,
} as const;

export type DiscordTimeStyle =
  | 't' // 20:00
  | 'T' // 20:00:30
  | 'd' // 07/10/2026
  | 'D' // 7 octobre 2026
  | 'f' // 7 octobre 2026 20:00
  | 'F' // mercredi 7 octobre 2026 20:00
  | 'R'; // dans 2 jours

/** Discord's date markup: each reader sees it in their own language and time zone, and `R`
 * counts down by itself ("in 2 days") without the message ever being edited. */
export function discordTime(date: Date, style: DiscordTimeStyle): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

const length = (text: string | undefined) => (text ? Array.from(text).length : 0);

function textOf(embed: DiscordEmbed): number {
  return (
    length(embed.title) +
    length(embed.description) +
    length(embed.footer?.text) +
    (embed.fields ?? []).reduce((sum, field) => sum + length(field.name) + length(field.value), 0)
  );
}

/**
 * The embed with every limit respected, so Discord never answers 400 for a long title or a long
 * description typed by a member. Texts are cut with "…"; a field with no name or no value (which
 * Discord refuses) is dropped; if the whole is still over 6000 characters the description gives
 * way first, then the last fields.
 */
export function fitEmbed(embed: DiscordEmbed): DiscordEmbed {
  const fitted: DiscordEmbed = { ...embed };

  if (fitted.title !== undefined) fitted.title = truncate(fitted.title, EMBED_LIMITS.title);
  if (fitted.description !== undefined) {
    fitted.description = truncate(fitted.description, EMBED_LIMITS.description);
  }
  if (fitted.footer) {
    fitted.footer = { text: truncate(fitted.footer.text, EMBED_LIMITS.footer) };
  }
  if (fitted.fields) {
    fitted.fields = fitted.fields
      .map((field) => ({
        ...field,
        name: truncate(field.name.trim(), EMBED_LIMITS.fieldName),
        value: truncate(field.value.trim(), EMBED_LIMITS.fieldValue),
      }))
      .filter((field) => field.name.length > 0 && field.value.length > 0)
      .slice(0, EMBED_LIMITS.fields);
  }

  let excess = textOf(fitted) - EMBED_LIMITS.total;
  if (excess > 0 && fitted.description) {
    const room = Math.max(0, length(fitted.description) - excess);
    fitted.description = room > 0 ? truncate(fitted.description, room) : undefined;
    excess = textOf(fitted) - EMBED_LIMITS.total;
  }
  while (excess > 0 && fitted.fields && fitted.fields.length > 0) {
    fitted.fields = fitted.fields.slice(0, -1);
    excess = textOf(fitted) - EMBED_LIMITS.total;
  }

  return fitted;
}
