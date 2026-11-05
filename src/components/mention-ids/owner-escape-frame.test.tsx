import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ pathname: '/settings' }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => mocks.pathname }));

const { OwnerEscapeFrame } = await import('./owner-escape-frame');

const frame = () =>
  render(
    <OwnerEscapeFrame gate={<div>the gate</div>} notice={<div>the notice</div>}>
      <div>the settings page</div>
    </OwnerEscapeFrame>,
  );

afterEach(cleanup);
beforeEach(() => {
  mocks.pathname = '/settings';
});

describe('what an owner who still has an id to give is shown', () => {
  it('on the settings: the page, with the notice above it, and no gate', () => {
    frame();
    expect(screen.getByText('the settings page')).toBeTruthy();
    expect(screen.getByText('the notice')).toBeTruthy();
    expect(screen.queryByText('the gate')).toBeNull();
  });

  it.each(['/dashboard', '/members', '/settings/other', '/events/new', '/'])(
    'on %s: the gate, and nothing of the page',
    (path) => {
      mocks.pathname = path;
      frame();
      expect(screen.getByText('the gate')).toBeTruthy();
      expect(screen.queryByText('the settings page')).toBeNull();
      expect(screen.queryByText('the notice')).toBeNull();
    },
  );
});
