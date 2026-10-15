import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentPath = '/events';

vi.mock('./intl-navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./intl-navigation')>()),
  usePathname: () => currentPath,
  // The router's own link, recognisable in the markup.
  IntlLink: ({ href, children }: { href: unknown; children?: ReactNode }) => (
    <a data-router-link="" href={typeof href === 'string' ? href : JSON.stringify(href)}>
      {children}
    </a>
  ),
}));

const { Link } = await import('./link');

const render = (node: ReactNode, locale = 'fr') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={{}}>
      {node}
    </NextIntlClientProvider>,
  );

describe('Link', () => {
  beforeEach(() => {
    currentPath = '/events';
  });

  it('is a plain anchor, with the language and the query string, for the page you are on', () => {
    const html = render(
      <Link href={{ pathname: '/events', query: { view: 'list', month: '2026-11' } }} className="x">
        Liste
      </Link>,
      'en',
    );
    expect(html).toBe('<a href="/en/events?view=list&amp;month=2026-11" class="x">Liste</a>');
  });

  it('is a plain anchor for a string address of the page you are on', () => {
    expect(render(<Link href="/events">Événements</Link>)).toBe(
      '<a href="/fr/events">Événements</a>',
    );
    expect(render(<Link href="/events?view=list">Liste</Link>)).toBe(
      '<a href="/fr/events?view=list">Liste</a>',
    );
  });

  it('does not hand the router its own options to the anchor', () => {
    const html = render(
      <Link href="/events" prefetch={false} scroll={false} replace>
        Événements
      </Link>,
    );
    expect(html).toBe('<a href="/fr/events">Événements</a>');
  });

  it('stays the router link for any other page', () => {
    expect(render(<Link href="/members">Membres</Link>)).toContain('data-router-link');
    expect(
      render(<Link href={{ pathname: '/events/abc', query: { occ: 1 } }}>Date</Link>),
    ).toContain('data-router-link');
  });

  it('stays the router link when it changes the language', () => {
    expect(
      render(
        <Link href="/events" locale="en">
          English
        </Link>,
      ),
    ).toContain('data-router-link');
  });
});
