import { getConfig } from '@/config';
import { iconPath } from '@/lib/branding/icon-links';
import { logoVersionOf } from '@/lib/branding/storage';

export const dynamic = 'force-dynamic';

/**
 * `/favicon.ico`, which some readers of a page (and old browsers) ask for without reading its `<link>`: sent to the same icon as the
 * tab (a PNG: every browser takes a PNG whatever the name says), the BDE's own or the one that comes with the platform. A redirect to a
 * path, so that the image has one address and one way of being sent.
 */
export function GET() {
  return new Response(null, {
    status: 307,
    headers: {
      Location: iconPath(48, logoVersionOf(getConfig().bde.logoPath)),
      'Cache-Control': 'no-store',
    },
  });
}
