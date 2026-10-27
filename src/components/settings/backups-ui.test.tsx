import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';
import type { BackupOverview } from '@/lib/backups/list';
import { archiveName } from '@/lib/backups/names';

configure({ asyncUtilTimeout: 5000 });

/** The backups of the settings page, with the real messages: what the owner reads, and the dialog of a download. */

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  runBackupNow: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/settings/actions', () => ({ runBackupNow: mocks.runBackupNow }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace: never) =>
      createTranslator({
        locale: 'fr',
        messages: (await import('../../../messages/fr.json')).default,
        namespace,
      }),
  };
});

const { BackupsSection } = await import('./backups-section');
const { BackupDownload } = await import('./backup-download');

const NAME = archiveName(new Date('2026-10-26T02:00:04Z'));
const overview = (patch: Partial<BackupOverview> = {}): BackupOverview => ({
  readable: true,
  backups: [
    {
      name: NAME,
      at: new Date('2026-10-26T02:00:04Z'),
      bytes: 108_107,
      level: 'restored',
      kind: 'scheduled',
    },
    {
      name: archiveName(new Date('2026-10-25T02:00:03Z')),
      at: new Date('2026-10-25T02:00:03Z'),
      bytes: 2_500_000,
      level: null,
      kind: null,
    },
  ],
  last: {
    name: NAME,
    at: new Date('2026-10-26T02:00:04Z'),
    bytes: 108_107,
    level: 'restored',
    kind: 'scheduled',
  },
  failuresSince: 0,
  lastFailure: null,
  stale: false,
  since: new Date('2026-10-01T00:00:00Z'),
  ...patch,
});

async function renderSection(
  patch: Partial<BackupOverview> = {},
  notice: Parameters<typeof BackupsSection>[0]['notice'] = null,
) {
  const element = await BackupsSection({
    overview: overview(patch),
    notice,
    locale: 'fr',
    timeZone: 'Europe/Paris',
    told: true,
  });
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      {element}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('the backups section', () => {
  it('says when the last backup was made (in the time zone of the BDE), how big it is and how far it was checked', async () => {
    await renderSection();
    expect(screen.getByRole('heading', { level: 2, name: 'Sauvegardes' })).toBeInTheDocument();
    // 02:00:04 UTC is 03:00 in Paris after the clocks went back
    expect(screen.getByText(/26 octobre 2026 à 03:00 · 108 ko/)).toBeInTheDocument();
    expect(screen.getByText(/remise dans une base de contrôle/)).toBeInTheDocument();
  });

  it('lists the backups kept with a download for each, named with its date', async () => {
    await renderSection();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: /Télécharger la sauvegarde du 26 oct. 2026/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Télécharger la sauvegarde du 25 oct. 2026/ }),
    ).toBeInTheDocument();
  });

  it('says there is no backup yet, and offers to make one', async () => {
    await renderSection({ backups: [], last: null });
    expect(
      screen.getByText('Aucune sauvegarde pour l’instant', { selector: 'p.text-body-strong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sauvegarder maintenant' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says it when no backup has succeeded for two days, and why the last attempt failed', async () => {
    await renderSection({
      stale: true,
      failuresSince: 3,
      lastFailure: { at: new Date('2026-10-27T02:30:00Z'), code: 'space' },
    });
    expect(screen.getByText('Aucune sauvegarde n’a réussi depuis deux jours')).toBeInTheDocument();
    expect(
      screen.getByText(/pas assez de place sur le disque des sauvegardes/),
    ).toBeInTheDocument();
  });

  it('says that nobody is told by message when no channel is chosen for the failures', async () => {
    const element = await BackupsSection({
      overview: overview(),
      notice: null,
      locale: 'fr',
      timeZone: 'Europe/Paris',
      told: false,
    });
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        {element}
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Aucun message ne prévient les propriétaires/)).toBeInTheDocument();
    cleanup();
    await renderSection();
    expect(screen.queryByText(/Aucun message ne prévient les propriétaires/)).toBeNull();
  });

  it('says nothing alarming when all is well', async () => {
    await renderSection();
    expect(screen.queryByText(/La dernière tentative a échoué/)).toBeNull();
    expect(screen.queryByText(/depuis deux jours/)).toBeNull();
  });

  it('says what a backup asked just now came to', async () => {
    await renderSection({}, 'made');
    expect(screen.getByText('La sauvegarde a été faite et vérifiée.')).toBeInTheDocument();
    cleanup();
    await renderSection({}, 'verify-secrets');
    expect(
      screen.getByText(/La sauvegarde a échoué : les clés de l’archive n’ouvrent pas/),
    ).toBeInTheDocument();
    cleanup();
    await renderSection({}, 'busy');
    expect(screen.getByText(/déjà en cours/)).toBeInTheDocument();
  });

  it('says the folder cannot be read, instead of an empty list', async () => {
    await renderSection({ readable: false, backups: [], last: null });
    expect(screen.getByText(/Le dossier des sauvegardes ne peut pas être lu/)).toBeInTheDocument();
  });

  it('has a reason, in both languages, for every failure the platform can come to', () => {
    const codes = Object.keys(fr.settings.backups.reasons).sort();
    expect(Object.keys(en.settings.backups.reasons).sort()).toEqual(codes);
    expect(codes).toEqual(
      [
        'archive',
        'dump',
        'folder',
        'lock',
        'secrets',
        'space',
        'unexpected',
        'verify-archive',
        'verify-restore',
        'verify-secrets',
      ].sort(),
    );
  });
});

describe('the download of a backup', () => {
  let downloaded: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    downloaded = null;
    URL.createObjectURL = vi.fn(() => 'blob:file');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = this.download;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const open = () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <BackupDownload name={NAME} dateLabel="26 oct. 2026" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Télécharger la sauvegarde du 26 oct. 2026/ }),
    );
    return screen.getByRole('dialog');
  };
  const fill = (first: string, second: string) => {
    fireEvent.change(screen.getByLabelText('Phrase de passe'), { target: { value: first } });
    fireEvent.change(screen.getByLabelText('Répétez la phrase de passe'), {
      target: { value: second },
    });
  };
  const submit = () =>
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Télécharger' }),
    );

  it('says, before anything is asked of the platform, that a lost passphrase cannot be recovered', () => {
    const dialog = open();
    expect(
      within(dialog).getByText(
        /Si vous la perdez, personne ne pourra plus ouvrir le fichier téléchargé/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        `Pour utiliser le fichier sur un serveur neuf : ./scripts/restore.sh ${NAME}.enc`,
      ),
    ).toBeInTheDocument();
  });

  it('asks the passphrase twice, and tells a short one or a typo without sending anything', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    open();
    fill('short', 'short');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('au moins 12 caractères');
    fill('a long enough passphrase', 'another long enough one');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('ne sont pas les mêmes');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sends the passphrase in the body of one request, then hands the file over under its name plus .enc', async () => {
    const fetchMock = vi.fn(async () => new Response('encrypted', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    open();
    fill('a long enough passphrase', 'a long enough passphrase');
    submit();
    await waitFor(() => expect(downloaded).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [address, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(address).toBe('/api/backups/download');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      name: NAME,
      passphrase: 'a long enough passphrase',
    });
    expect(address).not.toContain('passphrase');
    expect(downloaded).toBe(`${NAME}.enc`);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Le fichier a été téléchargé.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    vi.unstubAllGlobals();
  });

  it.each([
    ['missing', 404, /n’existe plus/],
    ['tooShort', 400, /au moins 12 caractères/],
    ['origin', 403, /n’a pas pu être préparé/],
  ])(
    'shows what the platform refused (%s) and keeps the dialog open',
    async (error, status, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ error }), { status })),
      );
      open();
      fill('a long enough passphrase', 'a long enough passphrase');
      submit();
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(downloaded).toBeNull();
      vi.unstubAllGlobals();
    },
  );

  it('says the file could not be prepared when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    open();
    fill('a long enough passphrase', 'a long enough passphrase');
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/n’a pas pu être préparé/),
    );
    vi.unstubAllGlobals();
  });

  it('forgets the passphrase when the dialog is closed', () => {
    open();
    fill('a long enough passphrase', 'a long enough passphrase');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    fireEvent.click(
      screen.getByRole('button', { name: /Télécharger la sauvegarde du 26 oct. 2026/ }),
    );
    expect(screen.getByLabelText('Phrase de passe')).toHaveValue('');
  });
});
