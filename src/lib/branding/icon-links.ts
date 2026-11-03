import type { Metadata } from 'next';
import type { IconSize } from './icons';

/**
 * Where the icons of the platform are, and what a page says about itself to the tab, the home screen of a phone and the readers of a link
 * (Discord, Slack, WhatsApp, iMessage): in one place, so that every page says the same thing.
 *
 * - The BDE uses the logo that comes with the platform: the icons are the files of \`public/icons\` (made from \`public/logo.png\`).
 * - The BDE sent its own logo: the icons are \`/api/logo/icon/<size>?v=<version>\`. The version is in the address, so that a new logo is a
 *   new address and no cache keeps the old icon; and removing the logo brings back the first address.
 *
 * **What a link preview says is the BDE's name, its logo and one generic sentence, on every page, and nothing else.** The platform is
 * private: a title of an event, the name of a member, anything a page shows to a member stays out of what the readers of a link see,
 * whoever the link was given to (the pages of the members are not even sent to a visitor, but the preview does not depend on that).
 */

export const iconPath = (size: IconSize, version: string | null): string =>
  version ? `/api/logo/icon/${size}?v=${version}` : `/icons/icon-${size}.png`;

export interface BrandFacts {
  name: string;
  /** The generic sentence, in the language of the page. */
  description: string;
  locale: string;
  /** The logo's version, null for the logo that comes with the platform. */
  logoVersion: string | null;
  /** The public address of the platform (`registeredAddress()`), null when it has none: a preview needs an absolute address for the image. */
  origin: string | null;
}

export function brandMetadata(brand: BrandFacts): Metadata {
  const { name, description, locale, logoVersion, origin } = brand;
  const image = origin ? new URL(iconPath(512, logoVersion), origin).toString() : null;
  return {
    ...(origin && { metadataBase: new URL(origin) }),
    title: { default: name, template: `%s · ${name}` },
    description,
    applicationName: name,
    icons: {
      icon: [
        { url: iconPath(48, logoVersion), sizes: '48x48' },
        { url: iconPath(192, logoVersion), sizes: '192x192' },
      ],
      apple: [{ url: iconPath(180, logoVersion), sizes: '180x180' }],
    },
    manifest: `/api/manifest${logoVersion ? `?v=${logoVersion}` : ''}`,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    openGraph: {
      type: 'website',
      siteName: name,
      title: name,
      description,
      locale,
      ...(image && { images: [{ url: image, width: 512, height: 512, alt: name }] }),
    },
    twitter: {
      card: 'summary',
      title: name,
      description,
      ...(image && { images: [image] }),
    },
  };
}
