/**
 * Texts sent to a chat webhook contain things members typed (a name from the 42 profile,
 * an event title...). Left as they are, they could make the webhook ping a whole server or
 * channel. These helpers defuse the broadcast mentions of each service; the adapters call
 * them on every subject and body, whoever the caller is.
 */

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/** `@everyone`, `@here`, `@channel`: a zero-width space after the `@` keeps the text readable
 * but is no longer a mention. */
function defuseBroadcast(text: string): string {
  return text.replace(/@(everyone|here|channel)\b/gi, `@${ZERO_WIDTH_SPACE}$1`);
}

/** Discord: also breaks the `<@id>`, `<@&role>`, `<#channel>` and `<!...>` forms. The webhook
 * additionally sends `allowed_mentions: { parse: [] }`, which stops any ping on Discord's side. */
export function neutralizeForDiscord(text: string): string {
  return defuseBroadcast(text).replace(/<(?=[@#!])/g, `<${ZERO_WIDTH_SPACE}`);
}

/** Slack: its own escaping rule (`&`, `<`, `>`) turns `<!channel>`, `<@U123>` and `<url|label>`
 * into plain text. */
export function neutralizeForSlack(text: string): string {
  return defuseBroadcast(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
