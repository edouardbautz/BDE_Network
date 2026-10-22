import type { NotificationEvent } from '@/config/schema';
import type { DiscordEmbed } from './discord-embed';
import { withDiscordCard } from './discord-card';
import { withEmailContent } from './email-card';
import type { EmailModel } from './email-layout';
import { withSlackBlocks } from './slack-card';
import type { SlackPayload } from './slack-blocks';
import type { EmailContent, NotificationMessage } from './types';

/** How each channel presents a notification. Only the builders of the channels the event is set to are ever called:
 * e-mail, Discord and Slack each pay only for their own. */
export interface RichBuilders {
  discord?: () => DiscordEmbed;
  email?: (brand: EmailModel['brand']) => EmailContent;
  slack?: (brand: EmailModel['brand']) => SlackPayload;
}

type Plain = Omit<NotificationMessage, 'to'>;

/** One presentation, isolated: when it cannot be built the message goes out without it (the channel sends the plain
 * `subject` and `body`), and the other channels are untouched. */
async function isolated(
  event: NotificationEvent,
  channel: string,
  message: Plain,
  add: () => Promise<Plain>,
): Promise<Plain> {
  try {
    return await add();
  } catch (error) {
    console.error(
      `[notifications] ${event}: the ${channel} presentation could not be built`,
      error,
    );
    return message;
  }
}

/** The message with the presentation of each of its channels added: a Discord card, a designed e-mail and a Slack message.
 * The plain `subject` and `body` always stay, as what a channel falls back to. */
export async function withRichMessage(
  event: NotificationEvent,
  message: Plain,
  { discord, email, slack }: RichBuilders,
): Promise<Plain> {
  let rich = message;
  if (discord) {
    rich = await isolated(event, 'Discord', rich, () => withDiscordCard(event, rich, discord));
  }
  if (email) {
    rich = await isolated(event, 'e-mail', rich, () => withEmailContent(event, rich, email));
  }
  if (slack) {
    rich = await isolated(event, 'Slack', rich, () => withSlackBlocks(event, rich, slack));
  }
  return rich;
}
