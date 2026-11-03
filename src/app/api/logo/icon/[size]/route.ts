import { getConfig } from '@/config';
import { iconSizeOf } from '@/lib/branding/icons';
import { imageNotFound, imageResponse } from '@/lib/branding/serve';
import { isLogoVersion, logoVersionOf, readIcon, readLogo } from '@/lib/branding/storage';

export const dynamic = 'force-dynamic';

/**
 * The icon of the BDE's own logo, at one of the sizes the platform needs (`branding/icons.ts`): the tab, the home screen of a phone, the
 * preview of a link. The one the owner's browser drew when the logo was sent, or the logo itself when there is none (a logo sent
 * before the icons existed). Public like the logo, and served the same way (`branding/serve.ts`). While the BDE uses the logo that comes
 * with the platform nothing is asked here: the pages point at the files of `public/icons`.
 *
 * `?v=<version>` is the logo of that version (cached for good); without it, the logo the settings point to.
 */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = iconSizeOf((await params).size);
  if (!size) return imageNotFound();

  const asked = new URL(request.url).searchParams.get('v');
  const version = isLogoVersion(asked) ? asked : logoVersionOf(getConfig().bde.logoPath);
  if (!version) return imageNotFound();

  const bytes = (await readIcon(version, size)) ?? (await readLogo(version));
  return imageResponse(bytes, `${version}-${size}`, isLogoVersion(asked));
}
