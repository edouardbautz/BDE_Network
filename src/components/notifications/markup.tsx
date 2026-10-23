import type { ReactNode } from 'react';

/**
 * The two chat markups the editor's preview draws, as small as they need to be: what the platform writes in a card (bold, italic,
 * links, the date markup, the mentions) and nothing else. This is a picture of the card, not a Discord or a Slack: the final word on how a
 * card looks is the test message the page can send.
 */

/** Who a mention names, by the identifier a chat platform gives it (the directory of the BDE). */
export type MentionLabels = Readonly<Record<string, string>>;

const DISCORD_INLINE =
  /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|<t:(\d+)(?::([a-zA-Z]))?>|<@&(\d+)>|<@!?(\d+)>|@(everyone|here)/g;

const SLACK_INLINE =
  /\*([^*\n]+)\*|_([^_\n]+)_|<!date\^\d+\^[^|>]*\|([^>]*)>|<(https?:\/\/[^|>\s]+)\|([^>]*)>|<(https?:\/\/[^>\s]+)>|<!(channel|here|everyone)>|<!subteam\^(\w+)>|<@(\w+)>/g;

const Mention = ({ children }: { children: ReactNode }) => (
  <span className="rounded-xs bg-accent-soft text-accent-ink px-1 font-medium">{children}</span>
);

function discordTime(seconds: number, style: string | undefined, locale: string): string {
  const date = new Date(seconds * 1000);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(date);
  switch (style) {
    case 't':
      return format({ timeStyle: 'short' });
    case 'T':
      return format({ timeStyle: 'medium' });
    case 'd':
      return format({ dateStyle: 'short' });
    case 'D':
      return format({ dateStyle: 'long' });
    case 'f':
      return format({ dateStyle: 'long', timeStyle: 'short' });
    case 'R': {
      const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
      const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const abs = Math.abs(minutes);
      if (abs < 60) return relative.format(minutes, 'minute');
      if (abs < 60 * 24) return relative.format(Math.round(minutes / 60), 'hour');
      return relative.format(Math.round(minutes / (60 * 24)), 'day');
    }
    default:
      return format({ dateStyle: 'full', timeStyle: 'short' });
  }
}

/** A line of a Discord card, with its inline markup. */
export function discordInline(
  text: string,
  locale: string,
  labels: MentionLabels = {},
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(DISCORD_INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const key = index++;
    if (match[1] !== undefined) out.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2] !== undefined) out.push(<em key={key}>{match[2]}</em>);
    else if (match[3] !== undefined) out.push(<em key={key}>{match[3]}</em>);
    else if (match[4] !== undefined)
      out.push(
        <span key={key} className="text-accent-ink underline">
          {match[4]}
        </span>,
      );
    else if (match[6] !== undefined)
      out.push(
        <span key={key} className="rounded-xs bg-surface-3 px-1">
          {discordTime(Number(match[6]), match[7], locale)}
        </span>,
      );
    else if (match[8] !== undefined)
      out.push(<Mention key={key}>@{labels[match[8]] ?? '…'}</Mention>);
    else if (match[9] !== undefined)
      out.push(<Mention key={key}>@{labels[match[9]] ?? '…'}</Mention>);
    else if (match[10] !== undefined) out.push(<Mention key={key}>@{match[10]}</Mention>);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isBlankLine = (line: string) => line.replaceAll('​', '').trim() === '';

/** The description of a Discord card: small caps lines, large headings, quotes, paragraphs. */
export function DiscordDescription({
  text,
  locale,
  labels,
}: {
  text: string;
  locale: string;
  labels?: MentionLabels;
}) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote
        key={`q${blocks.length}`}
        className="border-line border-s-4 ps-3 text-body leading-snug"
      >
        {quote.map((line, i) => (
          <div key={i}>{discordInline(line, locale, labels)}</div>
        ))}
      </blockquote>,
    );
    quote = [];
  };
  lines.forEach((line, i) => {
    if (line.startsWith('> ') || line === '>') {
      quote.push(line.slice(2));
      return;
    }
    flushQuote();
    if (isBlankLine(line)) blocks.push(<div key={i} className="h-1.5" />);
    else if (line.startsWith('-# '))
      blocks.push(
        <div key={i} className="text-muted-foreground text-small leading-snug">
          {discordInline(line.slice(3), locale, labels)}
        </div>,
      );
    else if (line.startsWith('### '))
      blocks.push(
        <div key={i} className="text-body-strong leading-snug font-semibold">
          {discordInline(line.slice(4), locale, labels)}
        </div>,
      );
    else
      blocks.push(
        <div key={i} className="text-body leading-snug">
          {discordInline(line, locale, labels)}
        </div>,
      );
  });
  flushQuote();
  return <>{blocks}</>;
}

/** The text of a Slack `mrkdwn` field, with its inline markup. */
export function slackInline(text: string, labels: MentionLabels = {}): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) out.push(<br key={`br${lineIndex}`} />);
    let last = 0;
    let index = 0;
    for (const match of line.matchAll(SLACK_INLINE)) {
      if (match.index > last) out.push(line.slice(last, match.index));
      last = match.index + match[0].length;
      const key = `${lineIndex}-${index++}`;
      if (match[1] !== undefined) out.push(<strong key={key}>{match[1]}</strong>);
      else if (match[2] !== undefined) out.push(<em key={key}>{match[2]}</em>);
      else if (match[3] !== undefined) out.push(match[3]);
      else if (match[4] !== undefined || match[6] !== undefined)
        out.push(
          <span key={key} className="text-accent-ink underline">
            {match[5] ?? match[4] ?? match[6]}
          </span>,
        );
      else if (match[7] !== undefined) out.push(<Mention key={key}>@{match[7]}</Mention>);
      else if (match[8] !== undefined)
        out.push(<Mention key={key}>@{labels[match[8]] ?? '…'}</Mention>);
      else if (match[9] !== undefined)
        out.push(<Mention key={key}>@{labels[match[9]] ?? '…'}</Mention>);
    }
    if (last < line.length) out.push(line.slice(last));
  });
  return out;
}
