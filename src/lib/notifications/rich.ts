import type { NotificationEvent } from '@/config/schema';
import type { DiscordEmbed } from './discord-embed';
import { withDiscordCard } from './discord-card';
import { withEmailContent } from './email-card';
import type { EmailModel } from './email-layout';
import { withSlackBlocks } from './slack-card';
import type { SlackPayload } from './slack-blocks';
import type { EmailContent, NotificationMessage } from './types';

/** How each channel presents a notification. Only the builder of the channel the event is set to is
 * ever called: e-mail, Discord and Slack each pay only for their own. */
export interface RichBuilders {
  discord?: () => DiscordEmbed;
  email?: (brand: EmailModel['brand']) => EmailContent;
  slack?: (brand: EmailModel['brand']) => SlackPayload;
}

/** The message with the presentation of its channel added: a Discord card, a designed e-mail or a
 * Slack message. The plain `subject` and `body` always stay, as what every other channel sends. */
export async function withRichMessage(
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'to'>,
  { discord, email, slack }: RichBuilders,
): Promise<Omit<NotificationMessage, 'to'>> {
  let rich = message;
  if (discord) rich = await withDiscordCard(event, rich, discord);
  if (email) rich = await withEmailContent(event, rich, email);
  if (slack) rich = await withSlackBlocks(event, rich, slack);
  return rich;
}
