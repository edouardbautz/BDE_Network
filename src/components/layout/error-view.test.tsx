import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { ErrorView } = await import('./error-view');
const { default: GlobalError } = await import('@/app/global-error');

afterEach(cleanup);

describe('ErrorView', () => {
  it('apologises, offers a retry and a way back to the dashboard', () => {
    const reset = vi.fn();
    render(<ErrorView error={new Error('boom')} reset={reset} />);

    expect(screen.getByText('error.title')).toBeTruthy();
    expect(document.querySelector('a[href="/dashboard"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'error.retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('never shows the error message itself, only its reference', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
      digest: 'abc123',
    });
    render(<ErrorView error={error} reset={vi.fn()} />);

    expect(document.body.textContent).not.toContain('ECONNREFUSED');
    expect(document.body.textContent).toContain('error.reference{"digest":"abc123"}');
  });

  it('shows no reference when there is none', () => {
    render(<ErrorView error={new Error('boom')} reset={vi.fn()} />);
    expect(document.body.textContent).not.toContain('error.reference');
  });
});

describe('global error page', () => {
  it('speaks both languages, retries, and leaves with a plain link', () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error('boom')} reset={reset} />);

    expect(document.body.textContent).toContain('Quelque chose');
    expect(document.body.textContent).toContain('Something went wrong');
    expect(document.body.textContent).not.toContain('boom');
    expect(document.querySelector('a[href="/"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('error page messages', () => {
  it.each([
    ['fr', fr],
    ['en', en],
  ])('are complete in %s', (_locale, messages) => {
    const { errorPages } = messages;
    for (const text of [
      errorPages.notFound.title,
      errorPages.notFound.description,
      errorPages.error.title,
      errorPages.error.description,
      errorPages.error.retry,
      errorPages.backToDashboard,
    ]) {
      expect(text.length).toBeGreaterThan(3);
    }
    expect(errorPages.error.reference).toContain('{digest}');
  });
});
