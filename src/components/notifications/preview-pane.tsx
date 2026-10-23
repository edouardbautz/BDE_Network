'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { DiscordEmbed } from '@/lib/notifications/discord-embed';
import type { SlackBlock, SlackPayload } from '@/lib/notifications/slack-blocks';
import type { Preview } from '@/lib/notifications/templates/preview';
import { DiscordDescription, discordInline, slackInline, type MentionLabels } from './markup';

/**
 * The notification as it will look, drawn from what the platform would post for the example (the server draws it with the code
 * that draws the real one; this only paints it). A Discord card and a Slack message are pictures of the real thing, not the
 * thing: the test message is what shows it on the real platform. An e-mail is shown in a frame that runs nothing.
 */

interface PreviewProps {
  preview: Preview;
  locale: string;
  bdeName: string;
  logoUrl?: string;
  labels: MentionLabels;
}

const decimalToCss = (value: number | undefined): string | undefined =>
  value === undefined ? undefined : `#${value.toString(16).padStart(6, '0')}`;

function Sender({ name, logoUrl }: { name: string; logoUrl?: string }) {
  return (
    <div className="flex items-center gap-2">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- the BDE's own picture, a plain address
        <img src={logoUrl} alt="" className="size-8 rounded-pill object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="bg-accent-fill text-accent-on flex size-8 items-center justify-center rounded-pill text-small font-semibold"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="text-body-strong">{name}</span>
    </div>
  );
}

function DiscordCard({
  embed,
  above,
  locale,
  bdeName,
  logoUrl,
  labels,
}: {
  embed: DiscordEmbed;
  above?: { text: string };
} & Omit<PreviewProps, 'preview'>) {
  const barColor = decimalToCss(embed.color);
  return (
    <div className="bg-surface-2 flex flex-col gap-2 rounded-lg p-3" data-testid="preview-discord">
      <Sender name={bdeName} logoUrl={logoUrl} />
      {above && above.text && (
        <p className="text-body whitespace-pre-wrap">{discordInline(above.text, locale, labels)}</p>
      )}
      <div
        className="bg-surface flex max-w-lg flex-col gap-2 rounded-md border-s-4 p-3"
        style={{ borderInlineStartColor: barColor } as CSSProperties}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {embed.author && (
              <div className="text-small flex items-center gap-1.5 font-semibold">
                {embed.author.icon_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- the BDE's own picture, a plain address
                  <img src={embed.author.icon_url} alt="" className="size-5 rounded-pill" />
                )}
                {embed.author.name}
              </div>
            )}
            {embed.title && (
              <div className="text-accent-ink text-body-strong break-words">{embed.title}</div>
            )}
            {embed.description && (
              <div className="flex flex-col">
                <DiscordDescription text={embed.description} locale={locale} labels={labels} />
              </div>
            )}
          </div>
          {embed.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element -- a picture of the platform or the BDE
            <img
              src={embed.thumbnail.url}
              alt=""
              className="size-14 shrink-0 rounded-md object-cover"
            />
          )}
        </div>
        {embed.fields && embed.fields.length > 0 && (
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
            {embed.fields.map((field, index) => (
              <div key={index} className={field.inline ? '' : 'sm:col-span-3'}>
                <div className="text-small font-semibold">{field.name}</div>
                <div className="text-body break-words">
                  {discordInline(field.value, locale, labels)}
                </div>
              </div>
            ))}
          </div>
        )}
        {embed.footer && (
          <div className="text-muted-foreground text-small">{embed.footer.text}</div>
        )}
      </div>
    </div>
  );
}

function SlackBlocks({ blocks, labels }: { blocks: SlackBlock[]; labels: MentionLabels }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'header':
            return (
              <div key={index} className="text-body-strong">
                {block.text.text}
              </div>
            );
          case 'section':
            return (
              <div key={index} className="flex flex-col gap-1.5">
                {block.text && (
                  <div className="text-body break-words">
                    {slackInline(block.text.text, labels)}
                  </div>
                )}
                {block.fields && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {block.fields.map((field, i) => (
                      <div key={i} className="text-body break-words">
                        {slackInline(field.text, labels)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          case 'context':
            return (
              <div
                key={index}
                className="text-muted-foreground text-small flex flex-wrap items-center gap-2"
              >
                {block.elements.map((element, i) =>
                  element.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the BDE's own picture, a plain address
                    <img
                      key={i}
                      src={element.image_url}
                      alt={element.alt_text}
                      className="size-5 rounded-xs"
                    />
                  ) : (
                    <span key={i}>{slackInline(element.text, labels)}</span>
                  ),
                )}
              </div>
            );
          case 'actions':
            return (
              <div key={index} className="flex flex-wrap gap-2">
                {block.elements.map((button, i) => (
                  <span
                    key={i}
                    className="bg-surface-2 text-body-strong rounded-md border border-line px-3 py-1.5"
                  >
                    {button.text.text}
                  </span>
                ))}
              </div>
            );
        }
      })}
    </>
  );
}

function SlackCard({
  message,
  bdeName,
  logoUrl,
  labels,
}: { message: SlackPayload } & Omit<PreviewProps, 'preview' | 'locale'>) {
  return (
    <div className="bg-surface-2 flex flex-col gap-2 rounded-lg p-3" data-testid="preview-slack">
      <Sender name={bdeName} logoUrl={logoUrl} />
      {message.above && (
        <p className="text-body whitespace-pre-wrap">{slackInline(message.above, labels)}</p>
      )}
      <div
        className="bg-surface flex max-w-lg flex-col gap-2 rounded-md border-s-4 p-3"
        style={{ borderInlineStartColor: message.color } as CSSProperties}
      >
        <SlackBlocks blocks={message.blocks} labels={labels} />
      </div>
    </div>
  );
}

function MailFrame({ html }: { html: string }) {
  const t = useTranslations('templates.preview');
  return (
    // `sandbox=""`: the frame runs no script and follows no link, whatever the message holds.
    <iframe
      title={t('mailFrame')}
      sandbox=""
      srcDoc={html}
      data-testid="preview-email"
      className="bg-surface h-[640px] w-full rounded-lg border border-line"
    />
  );
}

export function PreviewPane(props: PreviewProps) {
  const { preview } = props;
  if (preview.channel === 'discord') {
    return <DiscordCard {...props} embed={preview.embed} above={preview.above} />;
  }
  if (preview.channel === 'slack') {
    return <SlackCard {...props} message={preview.message} />;
  }
  return <MailFrame html={preview.mail.html} />;
}
