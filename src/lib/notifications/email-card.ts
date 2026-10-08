import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import type { EmailModel } from './email-layout';
import { resolveLogoUrl } from './sender';
import type { EmailContent, NotificationMessage } from './types';
import { registeredAddress } from '@/lib/public-address';

/** The BDE as the header of an e-mail shows it: its name and, when it can be loaded, its logo. */
export async function emailBrand(): Promise<EmailModel['brand']> {
  const { bde } = getConfig();
  // A mail client loads the logo itself, from the reader's machine: a private address is fine.
  const logoUrl = await resolveLogoUrl(registeredAddress() ?? undefined, bde.logoPath, {
    requirePublic: false,
  });
  return { name: bde.name, ...(logoUrl && { logoUrl }) };
}

/**
 * Adds the designed e-mail to a notification, when (and only when) its channel is e-mail: the
 * e-mail, and the check of the BDE's logo that goes with it, cost nothing for Discord or Slack. The
 * plain `subject` and `body` stay, as what every other channel sends.
 */
export async function withEmailContent(
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'to'>,
  build: (brand: EmailModel['brand']) => EmailContent,
): Promise<Omit<NotificationMessage, 'to'>> {
  if (getConfig().notifications[event] !== 'email') {
    return message;
  }

  return { ...message, email: build(await emailBrand()) };
}
