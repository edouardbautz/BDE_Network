import { getConfig } from '@/config';
import { imageNotFound, imageResponse } from '@/lib/branding/serve';
import { isLogoVersion, logoVersionOf, readLogo } from '@/lib/branding/storage';

export const dynamic = 'force-dynamic';

/**
 * The logo the BDE uploaded (settings page). Public on purpose: the login page, Discord, Slack and the readers
 * of e-mails all load it without a session. What is served is only ever an image the platform checked itself,
 * identified again by its bytes (never by a stored name), and sent so that a browser cannot take it for anything
 * else: `nosniff`, and a policy that forbids everything if somebody opens it as a page.
 *
 * `?v=<version>` is the file of that version (cached for good: a new logo is a new address). Without it, the
 * logo the settings currently point to.
 */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get('v');
  const version = isLogoVersion(asked) ? asked : logoVersionOf(getConfig().bde.logoPath);
  if (!version) return imageNotFound();
  return imageResponse(await readLogo(version), version, isLogoVersion(asked));
}
