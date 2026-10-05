import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';

const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace }) }));

const { UnavailableRetry } = await import('./unavailable-retry');

function renderIt() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <UnavailableRetry />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  replace.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UnavailableRetry', () => {
  it('goes back to the platform as soon as the health check passes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    renderIt();

    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(fetch).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('keeps waiting while the service is down, or the network is', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ ok: true }),
    );
    renderIt();

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(replace).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('lets the visitor retry by hand', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderIt();

    screen.getByRole('button', { name: 'Réessayer maintenant' }).click();

    expect(replace).toHaveBeenCalledWith('/');
  });
});
