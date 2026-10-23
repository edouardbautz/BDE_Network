import { neutralizeForDiscord, neutralizeForSlack } from '../sanitize';
import { truncate } from '../text';

/**
 * Mentions: the only way a message of the platform ever pings somebody, and it is written by a BDE in a template, never by
 * data.
 *
 * - **Only the message above the card can ping.** Discord does not notify for a mention inside a card, and Slack's is not
 *   reliable there: the template has one text above the card (`TemplateContent.above`), and it is the only place a mention is read.
 * - **Only what the template spells as a mention is one.** `{@everyone}`, `{@here}`, `{@channel}` (Slack), and `{@role:bureau}`,
 *   `{@user:paula}`, `{@group:bureau}`, whose names stand for an identifier of the platform in the BDE's directory
 *   (`NotificationMention`). A mention typed as plain text (`@everyone`), and everything a variable stands for (a title, a place,
 *   a name), comes out defused, as every text sent to a chat has always been.
 * - What comes out is the text with its mentions written for the platform, and the list of who may be pinged: Discord is told
 *   exactly that list (`allowed_mentions`), so even a mention that slipped into the text could not ping anybody else.
 *
 * The result is `TrustedText`: the adapters post it as it is and are given nothing else that way.
 */

declare const trusted: unique symbol;

/** A text already made harmless, and carrying the mentions the template asked for: the adapters post it as it is. */
export type TrustedText = string & { readonly [trusted]: true };

export type MentionPlatform = 'discord' | 'slack';
export type MentionKind = 'role' | 'user' | 'group';

export interface MentionEntry {
  platform: MentionPlatform;
  kind: MentionKind;
  label: string;
  externalId: string;
}

/** The BDE's directory, by the name templates use: `directoryKey('discord', 'bureau')`. */
export type MentionDirectory = Readonly<Record<string, MentionEntry>>;

export const directoryKey = (platform: MentionPlatform, key: string) => `${platform}:${key}`;

export interface AllowedMentions {
  /** `@everyone` or `@here` is in the text. */
  everyone: boolean;
  roles: string[];
  users: string[];
}

export interface RenderedAbove {
  text: TrustedText;
  mentions: AllowedMentions;
}

/** A mention as a template spells it. */
export type MentionToken =
  { kind: 'everyone' | 'here' | 'channel' } | { kind: MentionKind; key: string };

const TOKEN =
  /\{\{|\}\}|\{@(everyone|here|channel)\}|\{@(role|user|group):([a-z0-9]+(?:-[a-z0-9]+)*)\}|\{([a-z][a-z0-9_]*)\}/g;

/** The mentions written in a text, in order. */
export function mentionsIn(source: string): MentionToken[] {
  const found: MentionToken[] = [];
  for (const match of source.matchAll(TOKEN)) {
    if (match[1]) found.push({ kind: match[1] as 'everyone' | 'here' | 'channel' });
    else if (match[2]) found.push({ kind: match[2] as MentionKind, key: match[3]! });
  }
  return found;
}

/** What Discord's and Slack's own markup is for each mention. */
function markup(token: MentionToken, entry: MentionEntry | undefined, platform: MentionPlatform) {
  if (token.kind === 'everyone') return platform === 'discord' ? '@everyone' : '<!everyone>';
  if (token.kind === 'here') return platform === 'discord' ? '@here' : '<!here>';
  if (token.kind === 'channel') return platform === 'slack' ? '<!channel>' : undefined;
  if (!entry || entry.platform !== platform || entry.kind !== token.kind) return undefined;
  if (platform === 'discord') {
    return token.kind === 'role' ? `<@&${entry.externalId}>` : `<@${entry.externalId}>`;
  }
  return token.kind === 'group' ? `<!subteam^${entry.externalId}>` : `<@${entry.externalId}>`;
}

/** The longest message above a card: Discord's own limit for the text of a message. */
export const ABOVE_LIMIT = 2000;

/**
 * The text above a card, written for one platform. Words typed in the template and what the variables stand for are
 * defused; the mentions the template spells are written in the platform's markup (a mention whose name the directory does not
 * know, or is of the other platform, is left out). `undefined` when nothing is left to say.
 */
export function renderAbove(
  source: string | undefined,
  values: Readonly<Record<string, string>>,
  platform: MentionPlatform,
  directory: MentionDirectory = {},
): RenderedAbove | undefined {
  if (!source) return undefined;
  const defuse = platform === 'discord' ? neutralizeForDiscord : neutralizeForSlack;
  const mentions: AllowedMentions = { everyone: false, roles: [], users: [] };

  const parts: Array<{ text: string; cuttable: boolean }> = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: defuse(source.slice(last, index)), cuttable: true });
    last = index + match[0].length;

    if (match[0] === '{{' || match[0] === '}}') {
      parts.push({ text: match[0] === '{{' ? '{' : '}', cuttable: true });
    } else if (match[4]) {
      parts.push({ text: defuse(values[match[4]] ?? ''), cuttable: true });
    } else {
      const token: MentionToken = match[1]
        ? { kind: match[1] as 'everyone' | 'here' | 'channel' }
        : { kind: match[2] as MentionKind, key: match[3]! };
      const entry = 'key' in token ? directory[directoryKey(platform, token.key)] : undefined;
      const written = markup(token, entry, platform);
      if (!written) continue;
      parts.push({ text: written, cuttable: false });
      if (token.kind === 'everyone' || token.kind === 'here') mentions.everyone = true;
      else if (entry && token.kind === 'role') mentions.roles.push(entry.externalId);
      else if (entry && token.kind === 'user') mentions.users.push(entry.externalId);
    }
  }
  if (last < source.length) parts.push({ text: defuse(source.slice(last)), cuttable: true });

  // Cut to the limit between two parts: never in the middle of a mention.
  let text = '';
  let room = ABOVE_LIMIT;
  for (const part of parts) {
    const length = Array.from(part.text).length;
    if (length <= room) {
      text += part.text;
      room -= length;
    } else {
      if (part.cuttable && room > 1) text += truncate(part.text, room);
      break;
    }
  }
  text = text.trim();
  if (text === '') return undefined;

  // A mention that was cut away no longer pings.
  const kept = (id: string) => text.includes(id);
  return {
    text: text as TrustedText,
    mentions: {
      everyone: mentions.everyone && /@everyone|@here|<!everyone>|<!here>/.test(text),
      roles: [...new Set(mentions.roles)].filter(kept),
      users: [...new Set(mentions.users)].filter(kept),
    },
  };
}
