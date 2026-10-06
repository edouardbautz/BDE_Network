import { PLATFORM_NAME } from './platform';
import { defuseMentions, neutralizeForSlack, ZERO_WIDTH_SPACE } from './sanitize';
import { httpUrl, truncate } from './text';

/**
 * Slack "Block Kit" messages: the cards the platform posts in the BDE's Slack channel. This file holds
 * what is Slack-specific and shared by every notification: the shape of a message, the date markup
 * Slack renders in each reader's own time zone, the size limits Slack refuses a message over, and the
 * safety net the adapter applies to whatever a caller built. What each notification says lives next
 * to it (events/slack-blocks.ts, members/slack-blocks.ts).
 *
 * Two kinds of text: `plain_text` (a heading, a button) is never interpreted, `mrkdwn` is. A member's
 * text going into a `mrkdwn` field must go through `neutralizeForSlack` first (it turns `<!channel>`,
 * `<@U123>` and `<url|label>` into plain text); the date markup is written by the platform afterwards.
 */

export interface SlackText {
  type: 'plain_text' | 'mrkdwn';
  text: string;
}

export interface SlackImage {
  type: 'image';
  image_url: string;
  alt_text: string;
}

export type SlackBlock =
  | { type: 'header'; text: SlackText }
  | { type: 'section'; text?: SlackText; fields?: SlackText[]; accessory?: SlackImage }
  | { type: 'context'; elements: Array<SlackText | SlackImage> }
  | {
      type: 'actions';
      elements: Array<{ type: 'button'; text: SlackText; url: string }>;
    };

/** What a notification posts to Slack: a card with a colour bar at its side, and the plain text that
 * notifications (a phone's lock screen) show instead of the card. */
export interface SlackPayload {
  /** The plain summary of the card, for push notifications and clients that show no blocks. It goes in
   * the attachment's `fallback`, never in the message's own `text`: Slack shows that one in the
   * channel, above the card, which would say everything twice. */
  fallback: string;
  /** Colour of the bar at the card's side, a hex colour. */
  color: string;
  blocks: SlackBlock[];
}

/** Slack's documented limits. */
export const SLACK_LIMITS = {
  header: 150,
  section: 3000,
  field: 2000,
  fields: 10,
  button: 75,
  altText: 2000,
  contextElements: 10,
  blocks: 50,
  /** The notification text: enough for a phone's preview, not the whole card. */
  fallback: 300,
} as const;

/** The strings of one date that Slack renders in the reader's language and time zone. */
export type SlackDateFormat = '{date_long_pretty} {time}' | '{time}' | '{date_long}';

/** `<!date^…>`: each reader sees the date in their own time zone, with `fallback` where Slack
 * cannot render it (an old client, an e-mail digest). Slack has no countdown for the future ("in 3
 * days"), but `date_long_pretty` writes "today" and "tomorrow" for the days near. */
export function slackDate(date: Date, format: SlackDateFormat, fallback: string): string {
  const seconds = Math.floor(date.getTime() / 1000);
  // The fallback sits between `|` and `>`: neither may appear in it.
  const safeFallback = fallback.replace(/[<>|]/g, ' ');
  return `<!date^${seconds}^${format}|${safeFallback}>`;
}

/** The date markup the platform writes itself, and nothing else beginning with `<`. */
const DATE_MARKUP = /^<!date\^\d{1,12}\^(?:\{(?:date_long_pretty|date_long|time)\}| )+\|[^<>|]*>$/;

/** A `mrkdwn` text with everything Slack could act on made harmless, whoever built it: the broadcast
 * words get a zero-width space, and every `<…>` that is not the date markup is written as text (so a
 * `<!channel>`, a `<@U123>`, a `<#C123>` or a link cannot survive, whatever was passed). */
export function neutralizeSlackMrkdwn(text: string): string {
  return defuseMentions(text).replace(/<[^<>]*>|[<>]/g, (token) =>
    DATE_MARKUP.test(token) ? token : token.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );
}

/** Cuts a `mrkdwn` text to `max` characters without leaving half an entity (`&am…`) or half a
 * piece of markup (`<!date^…`) at the cut. */
export function truncateMrkdwn(text: string, max: number): string {
  const cut = truncate(text, max);
  if (cut === text) return text;
  const body = cut.slice(0, -1); // without the ellipsis
  const dangling = /(&[a-z]*|<[^>]*)$/.exec(body);
  return (dangling ? body.slice(0, dangling.index) : body).trimEnd() + '…';
}

const mrkdwn = (text: string, max: number): SlackText => ({
  type: 'mrkdwn',
  text: truncateMrkdwn(neutralizeSlackMrkdwn(text), max),
});
/** A `plain_text` is not interpreted by Slack, but the broadcast words and the `<!…`, `<@…`, `<#…` forms
 * are broken in it all the same (a zero-width space, invisible), so no client can ever act on them. */
const plain = (text: string, max: number): SlackText => ({
  type: 'plain_text',
  text: truncate(defuseMentions(text).replace(/<(?=[!@#])/g, `<${ZERO_WIDTH_SPACE}`), max),
});

/** An image Slack may fetch: an http(s) address, or nothing. */
function image(element: SlackImage): SlackImage | undefined {
  const url = httpUrl(element.image_url);
  return url
    ? { ...element, image_url: url, alt_text: plain(element.alt_text, SLACK_LIMITS.altText).text }
    : undefined;
}

function fitBlock(block: SlackBlock): SlackBlock | undefined {
  switch (block.type) {
    case 'header': {
      const text = plain(block.text.text, SLACK_LIMITS.header);
      return text.text ? { type: 'header', text } : undefined;
    }
    case 'section': {
      const fields = (block.fields ?? [])
        .map((field) => mrkdwn(field.text, SLACK_LIMITS.field))
        .filter((field) => field.text.trim() !== '')
        .slice(0, SLACK_LIMITS.fields);
      const text = block.text ? mrkdwn(block.text.text, SLACK_LIMITS.section) : undefined;
      const accessory = block.accessory ? image(block.accessory) : undefined;
      if (!text?.text.trim() && fields.length === 0) return undefined; // Slack refuses an empty section
      return {
        type: 'section',
        ...(text && text.text.trim() !== '' ? { text } : {}),
        ...(fields.length > 0 ? { fields } : {}),
        ...(accessory ? { accessory } : {}),
      };
    }
    case 'context': {
      const elements: Array<SlackText | SlackImage> = [];
      for (const element of block.elements) {
        const fitted =
          element.type === 'image' ? image(element) : mrkdwn(element.text, SLACK_LIMITS.field);
        if (fitted && (fitted.type === 'image' || fitted.text.trim() !== '')) elements.push(fitted);
      }
      elements.splice(SLACK_LIMITS.contextElements);
      return elements.length > 0 ? { type: 'context', elements } : undefined;
    }
    case 'actions': {
      const elements = block.elements.flatMap((button) => {
        const url = httpUrl(button.url);
        return url ? [{ ...button, text: plain(button.text.text, SLACK_LIMITS.button), url }] : [];
      });
      return elements.length > 0 ? { type: 'actions', elements } : undefined;
    }
  }
}

/**
 * The payload with every limit respected and every text made harmless, ready to post: texts cut with
 * "…", blocks Slack would refuse (empty, or pointing at an address that is not http) dropped, at most
 * 50 blocks. The adapter applies it to what a caller built, so a long title or a hostile name can
 * never get a message refused or ping a channel.
 */
export function fitSlackPayload(payload: SlackPayload): SlackPayload {
  return {
    fallback: plain(payload.fallback, SLACK_LIMITS.fallback).text,
    color: payload.color,
    blocks: payload.blocks
      .map(fitBlock)
      .filter((block): block is SlackBlock => block !== undefined)
      .slice(0, SLACK_LIMITS.blocks),
  };
}

/** The BDE's logo (when Slack can fetch it) and name, then the platform's, in the footer. */
export function slackFooter(brand: { name: string; logoUrl?: string }): SlackBlock {
  return {
    type: 'context',
    elements: [
      ...(brand.logoUrl
        ? [{ type: 'image' as const, image_url: brand.logoUrl, alt_text: brand.name }]
        : []),
      { type: 'mrkdwn', text: `${neutralizeForSlack(brand.name)} · ${PLATFORM_NAME}` },
    ],
  };
}

/** One button that opens `url`. */
export function slackButton(label: string, url: string): SlackBlock {
  return {
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: label }, url }],
  };
}
