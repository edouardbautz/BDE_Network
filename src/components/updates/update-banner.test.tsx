import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { UpdateBanner } from './update-banner';

/** The notice of a new version, with the real English messages and a stand-in for the platform's own route. */

const AVAILABLE = {
  state: 'available',
  current: '1.1.0',
  latest: '1.2.0',
  url: 'https://github.com/edouardbautz/BDE_Network/releases/tag/v1.2.0',
  summary: 'Install from your browser.',
};

const fetchMock = vi.fn();

function answer(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

const renderBanner = (enabled = true) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <UpdateBanner enabled={enabled} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UpdateBanner', () => {
  it('shows the new version, what it is about, the two commands and the way to its notes', async () => {
    answer(AVAILABLE);
    renderBanner();
    expect(await screen.findByText('Version 1.2.0 is available')).toBeInTheDocument();
    expect(screen.getByText('This platform runs version 1.1.0.')).toBeInTheDocument();
    expect(screen.getByText('Install from your browser.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('git pull')).toBeInTheDocument();
    expect(screen.getByDisplayValue('docker compose up -d')).toBeInTheDocument();
    const notes = screen.getByRole('link', { name: /What is new/ });
    expect(notes).toHaveAttribute('href', AVAILABLE.url);
    expect(notes).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /Upgrading guide/ })).toHaveAttribute(
      'href',
      'https://github.com/edouardbautz/BDE_Network/blob/main/docs/en/upgrading.md',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/updates', expect.anything());
  });

  it('shows nothing when the platform is up to date, does not know, or cannot answer', async () => {
    for (const body of [{ state: 'current' }, { state: 'unknown' }, { state: 'disabled' }]) {
      answer(body);
      const { unmount } = renderBanner();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByText(/is available/)).toBeNull();
      unmount();
      fetchMock.mockReset();
    }
    answer(null, false);
    renderBanner();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/is available/)).toBeNull();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderBanner();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('asks nobody, and shows nothing, while the check is off', async () => {
    answer(AVAILABLE);
    renderBanner(false);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('is hidden until the next version once dismissed, and comes back for a newer one', async () => {
    answer(AVAILABLE);
    const { unmount } = renderBanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide until the next version' }));
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(window.localStorage.getItem('bde-update-dismissed')).toBe('1.2.0');
    unmount();

    renderBanner();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/is available/)).toBeNull();
    cleanup();

    answer({ ...AVAILABLE, latest: '1.3.0' });
    renderBanner();
    expect(await screen.findByText('Version 1.3.0 is available')).toBeInTheDocument();
  });

  it('works without storage (a private window): it just comes back', async () => {
    answer(AVAILABLE);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderBanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide until the next version' }));
    expect(screen.queryByText(/is available/)).toBeNull();
    vi.restoreAllMocks();
  });

  it('shows text only: a summary with markup is not interpreted', async () => {
    answer({ ...AVAILABLE, summary: '<img src=x onerror=alert(1)>' });
    renderBanner();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('disappears when the owner turns the check off on the page', async () => {
    answer(AVAILABLE);
    const view = renderBanner(true);
    expect(await screen.findByText('Version 1.2.0 is available')).toBeInTheDocument();
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <UpdateBanner enabled={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/is available/)).toBeNull();
  });
});
