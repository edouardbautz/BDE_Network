import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthRejectedAlert } from './oauth-rejected-alert';

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

describe('OAuthRejectedAlert', () => {
  it('says what is wrong and offers the settings page where it can be fixed', async () => {
    render(await OAuthRejectedAlert({ withLink: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('title');
    expect(screen.getByRole('alert')).toHaveTextContent('body');
    expect(screen.getByRole('link', { name: 'cta' })).toHaveAttribute('href', '/settings');
  });

  it('has no link on the settings page itself', async () => {
    render(await OAuthRejectedAlert({}));
    expect(screen.getByRole('alert')).toHaveTextContent('body');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
