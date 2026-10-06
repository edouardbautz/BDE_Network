import { getConfig } from '@/config';
import { EMBED_LIMITS } from './discord-embed';
import { httpUrl, truncate } from './text';

/**
 * Who a Discord message appears to come from: the BDE's name and, when it can be shown, its logo.
 * The picture is an address Discord itself fetches, so it must be a **public** image in a format
 * Discord accepts (PNG, JPEG, GIF or WebP: not the SVG the interface uses by default). It is the
 * BDE's `logoPath` when that is such an image, `/logo.png` otherwise (the neutral one shipped in
 * `public/`, which a BDE replaces by its own). When Discord cannot reach it (a local install, a
 * private network, a server that does not answer), the message is simply sent under the BDE's name
 * without a picture, never with a broken one.
 */

export interface DiscordSender {
  username?: string;
  avatarUrl?: string;
}

/** Shipped in `public/`: what stands in for the avatar of a BDE whose `logoPath` is an SVG. */
export const DEFAULT_AVATAR_PATH = '/logo.png';

const RASTER_PATH = /\.(png|jpe?g|gif|webp)$/i;
const RASTER_TYPE = /^image\/(png|jpe?g|gif|webp)\b/i;

/** Discord refuses a webhook name that contains these words. */
const FORBIDDEN_NAMES = /clyde|discord/i;

/** An address Discord could reach from the Internet: not this machine, not a private network. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  if (host.includes(':')) {
    // An IPv6 address: not loopback, not unique-local (fc00::/7), not link-local (fe80::/10).
    return !(host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80'));
  }
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return host.includes('.'); // a bare name ("intranet") is not on the Internet
}

const CACHE_MS = 10 * 60 * 1000;
const checked = new Map<string, { at: number; usable: boolean }>();

/** Whether the picture answers, from the outside, as an image Discord accepts. Remembered for ten
 * minutes: a batch of notifications must not each wait for the same check. */
async function answersAsImage(url: string): Promise<boolean> {
  const known = checked.get(url);
  if (known && Date.now() - known.at < CACHE_MS) return known.usable;

  let usable = false;
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    usable = response.ok && RASTER_TYPE.test(response.headers.get('content-type') ?? '');
  } catch {
    usable = false;
  }
  checked.set(url, { at: Date.now(), usable });
  return usable;
}

/**
 * The address of the BDE's logo, or undefined when it cannot be shown. `requirePublic` is for a
 * reader that fetches it from the Internet (Discord); an e-mail client loads it from the reader's own
 * machine, so a BDE on a private network can pass `false`.
 */
export async function resolveLogoUrl(
  appUrl: string | undefined,
  logoPath: string,
  { requirePublic = true }: { requirePublic?: boolean } = {},
): Promise<string | undefined> {
  const base = httpUrl(appUrl?.trim());
  if (!base) return undefined;

  const root = new URL(base);
  if (requirePublic && !isPublicHost(root.hostname)) return undefined;

  // A path of this very site: `//other.example/x.png` would point elsewhere.
  const own = RASTER_PATH.test(logoPath) && /^\/(?!\/)/.test(logoPath);
  const logo = root.origin + (own ? logoPath : DEFAULT_AVATAR_PATH);
  return (await answersAsImage(logo)) ? logo : undefined;
}

/** Forgets what was learnt about logos: for tests. */
export function forgetCheckedLogos(): void {
  checked.clear();
}

/** The sender of the BDE's Discord messages: its name, and its logo when Discord can show it. */
export async function discordSender(): Promise<DiscordSender> {
  const { bde } = getConfig();
  const sender: DiscordSender = {};

  const name = bde.name.trim();
  if (name && !FORBIDDEN_NAMES.test(name)) {
    sender.username = truncate(name, EMBED_LIMITS.username);
  }

  const logo = await resolveLogoUrl(process.env.APP_URL, bde.logoPath);
  if (logo) sender.avatarUrl = logo;

  return sender;
}
