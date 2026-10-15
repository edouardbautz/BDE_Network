import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionButton } from './action-button';

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});
afterEach(cleanup);

describe('ActionButton', () => {
  it('runs the action once, then loads the address it answers instead of leaving the page as it was', async () => {
    const action = vi.fn(async () => ({ href: '/fr/events/evt1?occ=1' }));
    render(<ActionButton action={action}>Rétablir</ActionButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/fr/events/evt1?occ=1'));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('stays busy and cannot be pressed again while the browser replaces the page', async () => {
    render(<ActionButton action={async () => ({ href: '/x' })}>Rétablir</ActionButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: /Rétablir/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('loads nothing when the action answers nothing', async () => {
    const action = vi.fn(async () => undefined as never);
    render(<ActionButton action={action}>Rétablir</ActionButton>);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }));
    });

    expect(action).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
