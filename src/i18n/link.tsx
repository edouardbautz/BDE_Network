'use client';

import type { ComponentProps } from 'react';
import { useLocale } from 'next-intl';
import { IntlLink, getPathname, usePathname } from './intl-navigation';

type LinkProps = ComponentProps<typeof IntlLink>;

type Href = LinkProps['href'];

const pathnameOf = (href: Href) =>
  (typeof href === 'string' ? href.split(/[?#]/)[0] : href.pathname) ?? '';

/** What only the router understands: a plain `<a>` must not receive it. */
const ROUTER_PROPS = new Set([
  'replace',
  'scroll',
  'shallow',
  'prefetch',
  'passHref',
  'legacyBehavior',
  'as',
  'onNavigate',
  'transitionTypes',
]);

/** The address with its language prefix and its query string, as the real `Link` would write it. */
function addressOf(href: Href, locale: string) {
  if (typeof href === 'string') return getPathname({ href, locale });
  const query = typeof href.query === 'object' && href.query !== null ? href.query : undefined;
  return getPathname({ href: { pathname: pathnameOf(href), query }, locale });
}

/**
 * next-intl's `Link`, except for a link to the page you are already on (the next month, the list instead of the
 * calendar, one date of a series, the menu entry of the page you are reading): that one is a plain `<a>`, which
 * loads the page again.
 *
 * Why: in the production build, Next.js 15 and 16 (checked on 16.4.1) answer such a click with the "loading" state it cached for the page
 * (`loading.tsx`), then fetches the page and never shows it, and the address does not move either. Nothing is logged,
 * the development server does not do it, and only some timings do. A button that does nothing is worse than a page
 * that loads again. See "Navigation" in docs/architecture.md; `e2e/events.mjs` clicks these buttons for real.
 */
export function Link({ href, locale: toLocale, ...props }: LinkProps) {
  const pathname = usePathname();
  const locale = useLocale();

  if (toLocale === undefined && pathnameOf(href) === pathname) {
    const anchor = Object.fromEntries(
      Object.entries(props).filter(([key]) => !ROUTER_PROPS.has(key)),
    );
    return <a href={addressOf(href, locale)} {...(anchor as ComponentProps<'a'>)} />;
  }
  return <IntlLink href={href} locale={toLocale} {...props} />;
}
