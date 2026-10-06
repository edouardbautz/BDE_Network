import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';

/**
 * The `generateMetadata` of a page whose browser title is one message of the catalog: every page
 * gets its own title (WCAG 2.4.2), shown as "Page · BDE name" through the template of the root
 * layout. The locale comes from the route, not from the request context, which a statically
 * rendered page does not have yet when its metadata is built.
 *
 *     export const generateMetadata = pageTitle('members', 'title');
 *
 * The root layout's template reaches every page below it but not the page of its own segment
 * (the login page, at `/[locale]`): that one passes `{ framed: true }` to get "Title · BDE name"
 * itself.
 */
export function pageTitle(namespace: string, key: string, options: { framed?: boolean } = {}) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace });
    const title = t(key);
    return { title: options.framed ? `${title} · ${getConfig().bde.name}` : title };
  };
}
