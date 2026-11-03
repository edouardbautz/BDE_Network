import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
}));

const { linkRow, RowDetails, RowLink, rowAction, rowLinkLayer } = await import('./link-row');

afterEach(cleanup);

describe('the link of a row', () => {
  it('is a real link marked as the one of its row, stretched over the row, and drawing no ring of its own', () => {
    render(
      <RowLink href="/events/e1" className="text-body-strong">
        Soirée
      </RowLink>,
    );
    const link = screen.getByRole('link', { name: 'Soirée' });
    expect(link).toHaveAttribute('href', '/events/e1');
    expect(link).toHaveAttribute('data-row-link');
    expect(link.className).toContain('after:absolute');
    expect(link.className).toContain('after:inset-0');
    expect(link.className).toContain('focus-visible:outline-0'); // the row draws the ring
    expect(link.className).toContain('text-body-strong'); // the caller's own classes stay
    // the covering layer is made of the link's own pseudo-element: no second element, nothing nested
    expect(link.querySelector('a, button')).toBeNull();
  });
});

describe('the row', () => {
  it('shows the ground under the pointer and the ring of the keyboard around all of it, through the focus of its link', () => {
    for (const piece of [
      'relative',
      'hover:bg-surface-2',
      'has-[[data-row-link]:focus-visible]:outline',
      'has-[[data-row-link]:focus-visible]:outline-3',
      'has-[[data-row-link]:focus-visible]:outline-accent-ink',
    ]) {
      expect(linkRow).toContain(piece);
    }
    expect(rowLinkLayer).toContain("after:content-['']");
  });

  it('lifts what else can be clicked above the covering layer', () => {
    expect(rowAction).toBe('relative z-10');
  });
});

describe('"View details"', () => {
  it('is the words of a button, hidden from assistive technology: the title already says it, and it is no second stop', () => {
    const { container } = render(<RowDetails label="View details" />);
    const picture = container.firstElementChild as HTMLElement;
    expect(picture.textContent).toBe('View details');
    expect(picture).toHaveAttribute('aria-hidden', 'true');
    expect(picture.tagName).toBe('SPAN'); // not a button, not a link: nothing to focus
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    // it is not lifted above the layer: a click on it is a click on the link
    expect(picture.className).not.toContain('z-10');
    expect(picture.className).not.toContain('relative');
  });
});
