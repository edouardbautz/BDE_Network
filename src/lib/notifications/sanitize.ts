/**
 * Texts sent to a chat webhook contain things members typed (a name from the 42 profile,
 * an event title...). Left as they are, they could make the webhook ping a whole server or
 * channel. These helpers defuse the broadcast mentions of each service; the adapters call
 * them on every subject and body, whoever the caller is.
 */

import type { DiscordEmbed } from './discord-embed';

export const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/** `@everyone`, `@here`, `@channel`: a zero-width space after the `@` keeps the text readable
 * but is no longer a mention. */
export function defuseMentions(text: string): string {
  return text.replace(/@(everyone|here|channel)\b/gi, `@${ZERO_WIDTH_SPACE}$1`);
}

/** Discord: also breaks the `<@id>`, `<@&role>`, `<#channel>` and `<!...>` forms. The webhook
 * additionally sends `allowed_mentions: { parse: [] }`, which stops any ping on Discord's side. */
export function neutralizeForDiscord(text: string): string {
  return defuseMentions(text).replace(/<(?=[@#!])/g, `<${ZERO_WIDTH_SPACE}`);
}

/** A Discord card with every text a member could have written made harmless. Links, pictures,
 * colour and timestamp are not text and are left as they are (the `<t:…>` date markup the platform
 * writes itself is not touched either: only `<@`, `<#` and `<!` are broken). */
export function neutralizeEmbedForDiscord(embed: DiscordEmbed): DiscordEmbed {
  const safe = neutralizeForDiscord;
  return {
    ...embed,
    ...(embed.title !== undefined && { title: safe(embed.title) }),
    ...(embed.description !== undefined && { description: safe(embed.description) }),
    ...(embed.footer && { footer: { text: safe(embed.footer.text) } }),
    ...(embed.fields && {
      fields: embed.fields.map((field) => ({
        ...field,
        name: safe(field.name),
        value: safe(field.value),
      })),
    }),
  };
}

/** Slack: its own escaping rule (`&`, `<`, `>`) turns `<!channel>`, `<@U123>` and `<url|label>`
 * into plain text. */
export function neutralizeForSlack(text: string): string {
  return defuseMentions(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
