// How a person is mentioned on Discord and Slack in what the platform posts for the school's staff: their Discord user id
// (a number of 17 to 20 digits) and their Slack member id (a U or W and 8 to 12 capitals or digits). Never a name: a name can
// be anybody's, an id is exactly one account. They end up in a message that pings, so they are read strictly (the database
// refuses anything else too: migration 20261024120000_user_mention_ids) and nothing but the id ever reaches a message.

const DISCORD_ID = /^[0-9]{17,20}$/;
const SLACK_ID = /^[UW][A-Z0-9]{8,12}$/;

export type MentionIdResult = { ok: true; value: string | null } | { ok: false };

/** What a person pastes is often the mention itself (`<@123…>`, `<@!123…>`): the id inside is kept. */
function unwrapped(input: string): string {
  const text = input.trim();
  const mention = /^<@!?([^<>@!\s]+)>$/.exec(text);
  return (mention ? mention[1]! : text).trim();
}

/** A blank answer removes the id (null). */
export function parseDiscordUserId(input: string): MentionIdResult {
  const text = unwrapped(input);
  if (text === '') return { ok: true, value: null };
  return DISCORD_ID.test(text) ? { ok: true, value: text } : { ok: false };
}

export function parseSlackUserId(input: string): MentionIdResult {
  const text = unwrapped(input).toUpperCase();
  if (text === '') return { ok: true, value: null };
  return SLACK_ID.test(text) ? { ok: true, value: text } : { ok: false };
}

export interface MentionIds {
  discordUserId: string | null;
  slackUserId: string | null;
}

export type MentionIdsInput = { discordUserId: string; slackUserId: string };

export function parseMentionIds(
  input: MentionIdsInput,
):
  | { ok: true; data: MentionIds }
  | { ok: false; errors: Partial<Record<keyof MentionIdsInput, 'invalid'>> } {
  const discord = parseDiscordUserId(input.discordUserId);
  const slack = parseSlackUserId(input.slackUserId);
  if (discord.ok && slack.ok) {
    return { ok: true, data: { discordUserId: discord.value, slackUserId: slack.value } };
  }
  return {
    ok: false,
    errors: {
      ...(discord.ok ? {} : { discordUserId: 'invalid' as const }),
      ...(slack.ok ? {} : { slackUserId: 'invalid' as const }),
    },
  };
}
