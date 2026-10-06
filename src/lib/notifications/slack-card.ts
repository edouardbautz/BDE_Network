import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import type { EmailModel } from './email-layout';
import { resolveLogoUrl } from './sender';
import type { SlackPayload } from './slack-blocks';
import type { NotificationMessage } from './types';

/** The BDE as the footer of a Slack message shows it: its name and, when Slack can fetch it, its logo.
 * Slack loads the image itself from the Internet: a private address, an SVG or a server that does not
 * answer gives the name alone, never a broken picture. */
export async function slackBrand(): Promise<EmailModel['brand']> {
  const { bde } = getConfig();
  const logoUrl = await resolveLogoUrl(process.env.APP_URL, bde.logoPath);
  return { name: bde.name, ...(logoUrl && { logoUrl }) };
}

/**
 * Adds the Slack message to a notification, when (and only when) its channel is Slack: the blocks,
 * and the check of the BDE's logo that go with them, cost nothing for e-mail or Discord. The plain
 * `subject` and `body` stay, as the fallback of an adapter that cannot show blocks.
 */
export async function withSlackBlocks(
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'to'>,
  build: (brand: EmailModel['brand']) => SlackPayload,
): Promise<Omit<NotificationMessage, 'to'>> {
  if (getConfig().notifications[event] !== 'slack') {
    return message;
  }

  return { ...message, slack: build(await slackBrand()) };
}
