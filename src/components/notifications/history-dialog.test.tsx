import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';

const actions = vi.hoisted(() => ({ loadHistory: vi.fn(), restoreVersion: vi.fn() }));
vi.mock('@/app/[locale]/(app)/notifications/actions', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { HistoryDialog } = await import('./history-dialog');

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const ENTRIES = [
  {
    version: 3,
    action: 'restore',
    restoredFrom: 1,
    authorLogin: 'paula',
    createdAt: '2026-10-22T10:00:00.000Z',
    reset: false,
  },
  {
    version: 2,
    action: 'reset',
    authorLogin: 'sam',
    createdAt: '2026-10-21T10:00:00.000Z',
    reset: true,
  },
  {
    version: 1,
    action: 'save',
    authorLogin: 'sam',
    createdAt: '2026-10-20T10:00:00.000Z',
    reset: false,
  },
];

function show(over: { currentVersion?: number; dirty?: boolean } = {}) {
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <HistoryDialog
        open
        onOpenChange={onOpenChange}
        type="eventConfirmed"
        scope="all"
        scopeName="Tous les canaux"
        currentVersion={over.currentVersion ?? 3}
        dirty={over.dirty ?? false}
      />
    </NextIntlClientProvider>,
  );
  return { onOpenChange };
}

describe('the history of a template', () => {
  it('lists the versions newest first, says what made each and which is current', async () => {
    actions.loadHistory.mockResolvedValue({ entries: ENTRIES });
    show();
    expect(await screen.findByText('Version 3')).toBeInTheDocument();
    expect(actions.loadHistory).toHaveBeenCalledWith({ type: 'eventConfirmed', scope: 'all' });
    expect(screen.getByText('Actuelle')).toBeInTheDocument();
    expect(screen.getByText(/Restaurée depuis la version 1 · paula/)).toBeInTheDocument();
    expect(screen.getByText(/Retour au message de la plateforme · sam/)).toBeInTheDocument();
    expect(screen.getByText(/Enregistrée · sam/)).toBeInTheDocument();
    expect(
      screen.getByText('Le message de la plateforme, sans personnalisation.'),
    ).toBeInTheDocument();
  });

  it('offers to restore an older version that holds something, and not the current one nor a return to the platform’s own', async () => {
    actions.loadHistory.mockResolvedValue({ entries: ENTRIES });
    show();
    await screen.findByText('Version 3');
    expect(screen.getAllByRole('button', { name: /^Restaurer la version/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Restaurer la version 1' })).toBeInTheDocument();
  });

  it('asks before restoring, and loads the page again once it is done', async () => {
    actions.loadHistory.mockResolvedValue({ entries: ENTRIES });
    actions.restoreVersion.mockResolvedValue({ ok: false, code: 'restoreInvalid' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurer la version 1' }));
    const dialogs = await screen.findAllByRole('dialog');
    const confirm = dialogs.at(-1)!;
    expect(within(confirm).getByText('Restaurer la version 1 ?')).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Restaurer' }));
    await waitFor(() =>
      expect(actions.restoreVersion).toHaveBeenCalledWith({
        type: 'eventConfirmed',
        scope: 'all',
        version: 1,
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("n'est plus valable")),
    );
  });

  it('warns that what is typed will be lost', async () => {
    actions.loadHistory.mockResolvedValue({ entries: ENTRIES });
    show({ dirty: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurer la version 1' }));
    expect(
      await screen.findByText(/modifications non enregistrées de cette page seront perdues/),
    ).toBeInTheDocument();
  });

  it('says so when nothing was saved yet, and when it cannot be loaded', async () => {
    actions.loadHistory.mockResolvedValue({ entries: [] });
    show();
    expect(await screen.findByText(/Aucune version enregistrée/)).toBeInTheDocument();
    cleanup();
    actions.loadHistory.mockRejectedValue(new Error('down'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Impossible de charger l'historique.",
    );
  });

  it('says it is loading, and closes', async () => {
    actions.loadHistory.mockReturnValue(new Promise(() => {}));
    const { onOpenChange } = show();
    expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
    fireEvent.click(screen.getAllByRole('button', { name: 'Fermer' })[0]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
