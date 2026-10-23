import type { NotificationChannel } from '@/config/schema';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import type { NotificationEventData } from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { deriveAccent } from '@/lib/color';
import { signCard } from './discord-card';
import { emailBrand } from './email-card';
import { discordSender, type DiscordSender } from './sender';
import { slackBrand } from './slack-card';
import { getNotificationTranslate } from './translate';
import type { NotificationMessage } from './types';

export interface TestMessageContext {
  /** The name of the BDE, as the installer or the settings hold it. */
  name: string;
  locale: 'fr' | 'en';
  timeZone: string;
  /** The colour of the BDE: the bar of the card and the button of the e-mail. */
  accent: string;
  /** The platform's address, for the button, when there is one. */
  appUrl?: string | null;
  /**
   * Whether the platform is installed. Then the card is signed with the BDE's logo as the real ones are (and only when the
   * channel can fetch it); in the installer, which has no logo yet, it carries the name alone.
   */
  installed: boolean;
}

const HOUR = 60 * 60 * 1000;

/**
 * The message a channel gets when its test is asked for: **the same cards and the same e-mail as a real notification**, with an
 * invented event, marked "Test message", so the person sees how their channel will look with their name, their logo and
 * their colour, not only that something arrives. Only the presentation of the channel asked for is built. The plain `subject`
 * and `body` stay, as what a channel falls back to.
 */
export async function buildTestMessage(
  channel: NotificationChannel,
  context: TestMessageContext,
): Promise<NotificationMessage> {
  const { name, locale, timeZone, appUrl } = context;
  const t = await getNotificationTranslate(locale, 'events.notifications');
  const test = await getNotificationTranslate(locale, 'setup.test');

  const start = new Date(Date.now() + 3 * 24 * HOUR);
  const data: NotificationEventData = {
    eventId: 'test',
    title: test('sampleTitle'),
    description: test('sampleDescription', { name }),
    location: test('sampleLocation'),
    categoryLabel: test('sampleCategory'),
    categoryColor: deriveAccent(context.accent, 'light').fill,
    assigneeNames: [],
    start,
    end: new Date(start.getTime() + 2 * HOUR),
    repeat: null,
    url: appUrl ? `${appUrl}/${locale}` : null,
  };

  const message: NotificationMessage = {
    subject: test('subject', { name }),
    body: test('message', { name }),
  };

  if (channel === 'discord') {
    const sender: DiscordSender = context.installed ? await discordSender() : { username: name };
    return {
      ...message,
      discord: {
        embeds: [signCard(buildEventEmbed('test', data, t, timeZone), sender)],
        username: sender.username,
        avatarUrl: sender.avatarUrl,
      },
    };
  }

  if (channel === 'slack') {
    const brand = context.installed ? await slackBrand() : { name };
    return { ...message, slack: buildEventSlack('test', data, t, locale, timeZone, brand) };
  }

  const brand = context.installed ? await emailBrand() : { name, accent: context.accent };
  return { ...message, email: buildEventEmail('test', data, t, locale, timeZone, brand) };
}
