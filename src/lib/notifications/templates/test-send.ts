import { getConfig } from '@/config';
import { registeredAddress } from '@/lib/public-address';
import { setting } from '@/lib/settings/runtime';
import { describeSendError } from '@/lib/setup/notify-test';
import { notify } from '..';
import { resolveLogoUrl } from '../sender';
import { getNotificationTranslate } from '../translate';
import type { NotificationMessage } from '../types';
import type { TrustedText } from './mentions';
import { composeDrafts, inertMentions, type Drafts } from './compose';
import { renderPreview, type PreviewOptions } from './preview';
import type { TemplateIssue } from './schema';
import { loadMentions } from './store';
import type { TemplateChannel, TemplateContent, TemplateType } from './types';

/**
 * The test of a template: the notification of a type, drawn with an example **as it is on the editor's screen** (saved or not), sent
 * through the channel the BDE set up, so the person sees on the real platform how it will look. Not part of anything real: it says
 * it is a test, uses example data, and does not notify anybody unless the person asks for the mentions to be live.
 *
 * - **A test is rate limited** (one for a channel every ten seconds): a mention-rich template must not be a way to flood a channel.
 * - **Mentions are inert by default**: each one is written as the plain name the BDE gave it, so the test shows where it goes
 *   without pinging. The person can ask for them live, after a confirmation the page asks for.
 * - What goes wrong is a code, and a short reason with no address and no secret.
 */

export const TEST_EVERY_MS = 10_000;

export type TestOutcome =
  | { ok: true }
  | {
      ok: false;
      code: 'notConfigured' | 'rateLimited' | 'invalid' | 'failed';
      detail?: string;
      retryAfterSeconds?: number;
      issues?: Array<TemplateIssue & { scope: string }>;
    };

declare global {
  var templateTestClock: Map<TemplateChannel, number> | undefined;
}

/** Kept on `globalThis` like the other guards: Next.js bundles the actions and the pages separately. */
const clock = (): Map<TemplateChannel, number> => (globalThis.templateTestClock ??= new Map());

/** Whether the platform has what this channel needs to send. */
export function isChannelConfigured(channel: TemplateChannel): boolean {
  if (channel === 'discord') return Boolean(setting('DISCORD_WEBHOOK_URL'));
  if (channel === 'slack') return Boolean(setting('SLACK_WEBHOOK_URL'));
  return Boolean(setting('SMTP_HOST'));
}

export interface TestInput {
  type: TemplateType;
  channel: TemplateChannel;
  drafts: Drafts;
  /** The mentions of the template are live: they notify. */
  withMentions: boolean;
  /** Where the e-mail goes: the address of the person who asks. */
  to?: string | null;
}

/** The context a preview is drawn in: the BDE as it signs its messages. */
export async function previewOptions(): Promise<PreviewOptions> {
  const { bde } = getConfig();
  const appUrl = registeredAddress();
  const logoUrl = await resolveLogoUrl(appUrl ?? undefined, bde.logoPath, { requirePublic: false });
  return {
    locale: bde.defaultLocale as 'fr' | 'en',
    timeZone: bde.timezone,
    bdeName: bde.name,
    accent: bde.accentColor,
    ...(logoUrl && { logoUrl }),
    appUrl,
  };
}

/** The template with the message above its card written without any live mention. */
function withInertAbove(
  template: TemplateContent | undefined,
  directory: Parameters<typeof inertMentions>[1],
  channel: TemplateChannel,
): TemplateContent | undefined {
  if (!template?.above || channel === 'email') return template;
  return { ...template, above: inertMentions(template.above, directory, channel) };
}

export async function sendTemplateTest(
  input: TestInput,
  now: number = Date.now(),
): Promise<TestOutcome> {
  const { type, channel } = input;
  if (!isChannelConfigured(channel) || (channel === 'email' && !input.to)) {
    return { ok: false, code: 'notConfigured' };
  }

  const last = clock().get(channel);
  if (last !== undefined && now - last < TEST_EVERY_MS) {
    return {
      ok: false,
      code: 'rateLimited',
      retryAfterSeconds: Math.ceil((TEST_EVERY_MS - (now - last)) / 1000),
    };
  }

  const { directory } = await loadMentions();
  const composed = composeDrafts(type, channel, input.drafts, directory);
  if (!composed.ok) return { ok: false, code: 'invalid', issues: composed.issues };

  // from here on a test counts, whatever happens: a failing channel is not asked again at once either
  clock().set(channel, now);

  try {
    const options = await previewOptions();
    const template = input.withMentions
      ? composed.template
      : withInertAbove(composed.template, directory, channel);
    const preview = await renderPreview(type, channel, template, {
      ...options,
      mentions: directory,
    });
    const test = (await getNotificationTranslate(options.locale, 'events.notifications'))(
      'embed.kind.test',
    );

    let message: NotificationMessage;
    if (preview.channel === 'discord') {
      const above = preview.above;
      message = {
        subject: test,
        body: test,
        discord: {
          embeds: [preview.embed],
          username: options.bdeName,
          ...(options.logoUrl && { avatarUrl: options.logoUrl }),
          above: {
            text: `🧪 ${test}${above ? `\n${above.text}` : ''}` as TrustedText,
            mentions: above?.mentions ?? { everyone: false, roles: [], users: [] },
          },
        },
      };
    } else if (preview.channel === 'slack') {
      message = {
        subject: test,
        body: test,
        slack: {
          ...preview.message,
          above:
            `🧪 ${test}${preview.message.above ? `\n${preview.message.above}` : ''}` as TrustedText,
        },
      };
    } else {
      const subject = `[${test}] ${preview.mail.subject ?? test}`;
      message = {
        subject,
        body: preview.mail.text,
        to: input.to!,
        email: { ...preview.mail, subject },
      };
    }
    await notify(channel, message);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'failed', detail: describeSendError(error) };
  }
}
