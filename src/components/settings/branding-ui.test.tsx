import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import type { EventsSettingsView } from '@/lib/settings/view';

configure({ asyncUtilTimeout: 5000 });

/** The logo and the events sections of the settings page, with the real French messages and the actions played. */

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  saveLogo: vi.fn(),
  removeLogo: vi.fn(),
  saveEvents: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/app/[locale]/(app)/settings/actions', () => ({
  saveLogo: mocks.saveLogo,
  removeLogo: mocks.removeLogo,
  saveEvents: mocks.saveEvents,
}));

const { LogoSection } = await import('./logo-section');
const { EventsSection } = await import('./events-section');

const wrap = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      {node}
    </NextIntlClientProvider>,
  );

const png = (name = 'logo.png', size = 1024) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  mocks.saveLogo.mockResolvedValue({ ok: true });
  mocks.removeLogo.mockResolvedValue({ ok: true });
  mocks.saveEvents.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('the logo section', () => {
  const choose = (file: File) =>
    fireEvent.change(screen.getByLabelText('Choisir une image'), { target: { files: [file] } });

  it('shows the logo in use, and says which one it is', () => {
    wrap(<LogoSection logoPath="/logo.svg" custom={false} />);
    expect(screen.getByRole('img', { name: 'Logo actuel' })).toHaveAttribute('src', '/logo.svg');
    expect(screen.getByText('Le logo fourni avec la plateforme')).toBeInTheDocument();
    expect(screen.getByText(/PNG, JPEG, GIF ou WebP · 2 Mo au plus/)).toBeInTheDocument();
    // nothing to go back to
    expect(screen.queryByRole('button', { name: 'Revenir au logo par défaut' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Enregistrer le logo' })).toBeDisabled();
  });

  it('offers only the formats the server accepts (no SVG)', () => {
    wrap(<LogoSection logoPath="/logo.svg" custom={false} />);
    const accept = screen.getByLabelText('Choisir une image').getAttribute('accept') ?? '';
    expect(accept.split(',').sort()).toEqual([
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('previews the chosen image, then sends it as a file', async () => {
    wrap(<LogoSection logoPath="/logo.svg" custom={false} />);
    const file = png();
    choose(file);

    expect(screen.getByRole('img', { name: 'Logo actuel' })).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByText('Aperçu du nouveau logo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le logo' }));
    await waitFor(() => expect(mocks.saveLogo).toHaveBeenCalledTimes(1));
    const body = mocks.saveLogo.mock.calls[0]?.[0] as FormData;
    expect(body.get('logo')).toBeInstanceOf(File);
    expect((body.get('logo') as File).name).toBe('logo.png');
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Enregistré'));
  });

  it('refuses a file that is too large before sending anything', () => {
    wrap(<LogoSection logoPath="/logo.svg" custom={false} />);
    choose(png('big.png', 2 * 1024 * 1024 + 1));

    expect(screen.getByText(/trop lourd : 2 Mo au plus/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer le logo' })).toBeDisabled();
    expect(mocks.saveLogo).not.toHaveBeenCalled();
  });

  it('says what the server refused, in words, and does not say "saved"', async () => {
    mocks.saveLogo.mockResolvedValue({ ok: false, code: 'logoFormat', field: 'logo' });
    wrap(<LogoSection logoPath="/logo.svg" custom={false} />);
    choose(png());
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le logo' }));

    expect(await screen.findByText(/Format non accepté/)).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('goes back to the default logo only after a confirmation', async () => {
    wrap(<LogoSection logoPath="/api/logo?v=0123456789abcdef" custom />);
    expect(screen.getByText('Le logo de votre BDE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revenir au logo par défaut' }));
    expect(mocks.removeLogo).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Revenir au logo par défaut ?');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Revenir au logo par défaut',
      ) as HTMLElement,
    );
    await waitFor(() => expect(mocks.removeLogo).toHaveBeenCalledTimes(1));
  });
});

describe('the events section', () => {
  const settings = (patch: Partial<EventsSettingsView> = {}): EventsSettingsView => ({
    categories: [
      { key: 'soiree', label: 'Soirée', color: '#db2777' },
      { key: 'sport', label: 'Sport', color: '#16a34a' },
    ],
    usage: { soiree: 4, sport: 0 },
    reminderHour: 18,
    timezone: 'Europe/Paris',
    ...patch,
  });
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  it('lists the categories with their names, colours and how many events use them', () => {
    wrap(<EventsSection settings={settings()} />);
    expect(screen.getByLabelText('Nom de la catégorie 1')).toHaveValue('Soirée');
    expect(screen.getByLabelText('Nom de la catégorie 2')).toHaveValue('Sport');
    expect(screen.getByLabelText('Couleur de Soirée')).toHaveValue('#db2777');
    expect(screen.getByText('4 événements')).toBeInTheDocument();
    expect(screen.getByLabelText('Heure du rappel')).toHaveValue('18');
    expect(screen.getByText(/fuseau Europe\/Paris/)).toBeInTheDocument();
  });

  it('renames, recolours and changes the hour, keeping the key of each category', async () => {
    wrap(<EventsSection settings={settings()} />);
    fireEvent.change(screen.getByLabelText('Nom de la catégorie 1'), { target: { value: 'Fête' } });
    fireEvent.change(screen.getByLabelText('Couleur de Sport'), { target: { value: '#000000' } });
    fireEvent.change(screen.getByLabelText('Heure du rappel'), { target: { value: '9' } });
    save();

    await waitFor(() =>
      expect(mocks.saveEvents).toHaveBeenCalledWith({
        categories: [
          { key: 'soiree', label: 'Fête', color: '#db2777' },
          { key: 'sport', label: 'Sport', color: '#000000' },
        ],
        reminderHour: 9,
        reassign: {},
      }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Enregistré'));
  });

  it('adds a category: it has no key yet, the server makes it', async () => {
    wrap(<EventsSection settings={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une catégorie' }));
    fireEvent.change(screen.getByLabelText('Nom de la catégorie 3'), {
      target: { value: 'Tournoi' },
    });
    save();

    await waitFor(() => expect(mocks.saveEvents).toHaveBeenCalledTimes(1));
    const sent = mocks.saveEvents.mock.calls[0]?.[0] as {
      categories: Array<{ key?: string; label: string }>;
    };
    expect(sent.categories.map((c) => [c.key, c.label])).toEqual([
      ['soiree', 'Soirée'],
      ['sport', 'Sport'],
      [undefined, 'Tournoi'],
    ]);
  });

  it('forgets a category that was never saved without asking anything', () => {
    wrap(<EventsSection settings={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une catégorie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer nouvelle catégorie' }));
    expect(screen.queryByLabelText('Nom de la catégorie 3')).toBeNull();
    expect(screen.queryByText("Seront retirées à l'enregistrement")).toBeNull();
  });

  it('takes a category no event uses out only after a confirmation', async () => {
    wrap(<EventsSection settings={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Sport' }));
    expect(screen.getByText("Seront retirées à l'enregistrement")).toBeInTheDocument();
    save();
    expect(mocks.saveEvents).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Retirer cette catégorie ?');
    expect(dialog).toHaveTextContent("Aucun événement n'utilise cette catégorie.");
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retirer et enregistrer',
      ) as HTMLElement,
    );

    await waitFor(() =>
      expect(mocks.saveEvents).toHaveBeenCalledWith({
        categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }],
        reminderHour: 18,
        reassign: {},
      }),
    );
  });

  it('asks where the events of a removed category go, and says how many', async () => {
    wrap(
      <EventsSection
        settings={settings({
          categories: [
            { key: 'soiree', label: 'Soirée', color: '#db2777' },
            { key: 'sport', label: 'Sport', color: '#16a34a' },
            { key: 'wei', label: 'WEI', color: '#ea580c' },
          ],
          usage: { soiree: 4, sport: 2, wei: 0 },
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Sport' }));

    // 2 events: the choice is offered, among the categories that stay
    const target = screen.getByLabelText(/Ses 2 événements passeront dans la catégorie/);
    expect(Array.from(target.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'Soirée',
      'WEI',
    ]);
    fireEvent.change(target, { target: { value: 'wei' } });
    save();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Les 2 événements concernés seront déplacés');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retirer et enregistrer',
      ) as HTMLElement,
    );

    await waitFor(() => expect(mocks.saveEvents).toHaveBeenCalledTimes(1));
    expect(mocks.saveEvents.mock.calls[0]?.[0]).toMatchObject({
      categories: [{ key: 'soiree' }, { key: 'wei' }],
      reassign: { sport: 'wei' },
    });
  });

  it('lets one change one’s mind about a removal', () => {
    wrap(<EventsSection settings={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Sport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Garder' }));
    expect(screen.getByLabelText('Nom de la catégorie 2')).toHaveValue('Sport');
    expect(screen.queryByText("Seront retirées à l'enregistrement")).toBeNull();
  });

  it('never lets the last category go', () => {
    wrap(
      <EventsSection
        settings={settings({ categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }] })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retirer Soirée' })).toBeDisabled();
    expect(screen.getByText('Il faut garder au moins une catégorie.')).toBeInTheDocument();
  });

  it('shows what the server refused, under the categories', async () => {
    mocks.saveEvents.mockResolvedValue({
      ok: false,
      code: 'categoryDuplicate',
      field: 'categories',
    });
    wrap(<EventsSection settings={settings()} />);
    save();
    expect(await screen.findByText('Deux catégories portent le même nom.')).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
