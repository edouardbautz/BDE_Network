import { getConfig } from '@/config';
import { iconPath } from '@/lib/branding/icon-links';
import { logoVersionOf } from '@/lib/branding/storage';
import { deriveAccent } from '@/lib/color';

export const dynamic = 'force-dynamic';

/**
 * The web app manifest: what a phone shows when somebody adds the platform to their home screen (the name, the icon, the colours).
 * Public, because a browser reads it without a session, and it holds what the login page already shows to a visitor: the BDE's name and
 * its logo, nothing else. It follows the logo and the name at once (no cache: `must-revalidate`, and the icons carry the version of
 * the logo in their address).
 */
export function GET() {
  const { bde } = getConfig();
  const version = logoVersionOf(bde.logoPath);
  const accent = deriveAccent(bde.accentColor, 'light');
  const manifest = {
    name: bde.name,
    short_name: bde.name.length > 12 ? bde.name.slice(0, 12).trim() : bde.name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: accent.fill,
    icons: [
      { src: iconPath(192, version), sizes: '192x192', purpose: 'any' },
      { src: iconPath(512, version), sizes: '512x512', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
