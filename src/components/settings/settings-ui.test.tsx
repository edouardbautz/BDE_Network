import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import type { SettingsExtras } from '@/lib/settings/view';
import type { DraftView } from '@/lib/setup/draft';

configure({ asyncUtilTimeout: 5000 });

/** The forms of the settings page, with the real French messages and the server actions played. */

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  saveIdentity: vi.fn(),
  saveAddress: vi.fn(),
  verifyFortyTwo: vi.fn(),
  skipFortyTwoVerification: vi.fn(),
  loadCampuses: vi.fn(),
  saveCampuses: vi.fn(),
  saveModules: vi.fn(),
  saveNotifications: vi.fn(),
  testNotification: vi.fn(),
  checkOwner: vi.fn(),
  addOwner: vi.fn(),
  removeOwner: vi.fn(),
  saveLogo: vi.fn(),
  removeLogo: vi.fn(),
  saveEvents: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/app/[locale]/(app)/settings/actions', () => ({
  saveIdentity: mocks.saveIdentity,
  saveAddress: mocks.saveAddress,
  verifyFortyTwo: mocks.verifyFortyTwo,
  skipFortyTwoVerification: mocks.skipFortyTwoVerification,
  loadCampuses: mocks.loadCampuses,
  saveCampuses: mocks.saveCampuses,
  saveModules: mocks.saveModules,
  saveNotifications: mocks.saveNotifications,
  testNotification: mocks.testNotification,
  checkOwner: mocks.checkOwner,
  addOwner: mocks.addOwner,
  removeOwner: mocks.removeOwner,
  saveLogo: mocks.saveLogo,
  removeLogo: mocks.removeLogo,
  saveEvents: mocks.saveEvents,
}));

const { SettingsPanels } = await import('./settings-panels');

const view = (patch: Partial<DraftView> = {}): DraftView => ({
  step: 8,
  name: 'BDE Test',
  accentColor: '#0f766e',
  messageLocale: 'fr',
  contactEmail: '',
  addressUrl: 'https://bde.exemple.fr',
  clientId: 'u-s4t2ud-uid-abcdef',
  hasClientSecret: true,
  credentialsVerified: false,
  credentialsSkipped: false,
  campuses: ['Nice'],
  mainCampus: 'Nice',
  timezone: 'Europe/Paris',
  owners: ['alice', 'bob'],
  events: true,
  notifications: {
    mode: 'none',
    hasDiscordWebhook: false,
    hasSlackWebhook: false,
    smtp: { host: '', port: '587', user: '', from: '', hasPassword: false },
  },
  ...patch,
});

const extras = (patch: Partial<SettingsExtras> = {}): SettingsExtras => ({
  logo: { path: '/logo.svg', custom: false },
  events: {
    categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }],
    usage: { soiree: 3 },
    reminderHour: 18,
    timezone: 'Europe/Paris',
  },
  ...patch,
});

function renderPanels(patch: Partial<DraftView> = {}, extra: Partial<SettingsExtras> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <SettingsPanels view={view(patch)} extras={extras(extra)} actorLogin="alice" />
    </NextIntlClientProvider>,
  );
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of [
    'saveIdentity',
    'saveAddress',
    'saveCampuses',
    'saveModules',
    'saveNotifications',
    'removeOwner',
    'addOwner',
  ] as const) {
    mocks[name].mockResolvedValue({ ok: true });
  }
  mocks.loadCampuses.mockResolvedValue({
    ok: true,
    campuses: [{ name: 'Nice', country: 'France', timeZone: 'Europe/Paris' }],
  });
  mocks.checkOwner.mockResolvedValue({ ok: true, login: 'carol', status: 'exists' });
});
afterEach(cleanup);

describe('the sections', () => {
  it('are the installer’s forms, with their current values, each with its own Save button', async () => {
    renderPanels();
    await screen.findByLabelText('Rechercher un campus');

    for (const title of [
      'Votre BDE',
      'Logo',
      'Adresse de la plateforme',
      'Application 42',
      'Campus',
      'Propriétaires',
      'Modules',
      'Événements',
      'Notifications',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Nom du BDE')).toHaveValue('BDE Test');
    expect(screen.getByLabelText('Adresse publique')).toHaveValue('https://bde.exemple.fr');
    expect(screen.getByLabelText('UID (identifiant)')).toHaveValue('u-s4t2ud-uid-abcdef');
    expect(screen.getByLabelText('Campus de votre BDE')).toHaveValue('Nice');

    // a walk has Back and Continue; a page of settings has Save
    expect(screen.queryByRole('button', { name: 'Retour' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continuer' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Enregistrer' }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('button', { name: 'Vérifier et enregistrer' })).toBeInTheDocument();
  });

  it('do not take the focus when the page opens', async () => {
    renderPanels();
    await screen.findByLabelText('Rechercher un campus');
    expect(document.body).toHaveFocus();
  });

  it('never have the 42 secret, only say it is there', () => {
    renderPanels();
    expect(screen.getByLabelText('SECRET (clé secrète)')).toHaveValue('');
    expect(screen.getByText(/déjà enregistrée/)).toBeInTheDocument();
  });

  it('save one section, and say so', async () => {
    renderPanels();
    fireEvent.change(screen.getByLabelText('Nom du BDE'), { target: { value: 'Le BDE' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0] as HTMLElement);

    await waitFor(() =>
      expect(mocks.saveIdentity).toHaveBeenCalledWith({
        name: 'Le BDE',
        accentColor: '#0f766e',
        messageLocale: 'fr',
        contactEmail: '',
      }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Enregistré'));
    expect(mocks.saveAddress).not.toHaveBeenCalled(); // only that section
  });

  it('show the refusal under the field, and do not say "saved"', async () => {
    mocks.saveIdentity.mockResolvedValue({ ok: false, code: 'name', field: 'name' });
    renderPanels();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0] as HTMLElement);
    expect(await screen.findByText(/entre 1 et 60 caractères/)).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('check the 42 application before saving, and keep the guide folded', async () => {
    mocks.verifyFortyTwo.mockResolvedValue({
      ok: false,
      code: 'invalidCredentials',
      field: 'clientSecret',
    });
    renderPanels();
    const guide = screen.getByText('Pas à pas').closest('details');
    expect(guide).not.toBeNull();
    expect(guide).not.toHaveAttribute('open');

    fireEvent.change(screen.getByLabelText('SECRET (clé secrète)'), {
      target: { value: 's-s4t2ud-wrong-secret' },
    });
    click('Vérifier et enregistrer');
    expect(await screen.findByText(/42 refuse ces identifiants/)).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('turn a module off', async () => {
    renderPanels();
    fireEvent.click(screen.getByRole('switch'));
    const save = screen.getByRole('switch').closest('form')?.querySelector('button[type="submit"]');
    fireEvent.click(save as HTMLElement);
    await waitFor(() => expect(mocks.saveModules).toHaveBeenCalledWith({ events: false }));
  });
});

describe('the owners', () => {
  it('are listed, oneself without a way to remove oneself', () => {
    renderPanels();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('(vous)')).toBeInTheDocument();
    expect(screen.getByText(/Vous ne pouvez pas vous retirer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirer alice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retirer bob' })).toBeInTheDocument();
  });

  it('are removed only after a confirmation that says what happens', async () => {
    renderPanels();
    click('Retirer bob');
    expect(await screen.findByText('Retirer bob des propriétaires ?')).toBeInTheDocument();
    expect(screen.getByText(/rôle par défaut/)).toBeInTheDocument();
    expect(mocks.removeOwner).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' }).at(-1) as HTMLElement);
    await waitFor(() => expect(mocks.removeOwner).toHaveBeenCalledWith({ login: 'bob' }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Enregistré'));
  });

  it('cancelling a removal does nothing', async () => {
    renderPanels();
    click('Retirer bob');
    await screen.findByText('Retirer bob des propriétaires ?');
    click('Annuler');
    await waitFor(() => expect(screen.queryByText('Retirer bob des propriétaires ?')).toBeNull());
    expect(mocks.removeOwner).not.toHaveBeenCalled();
  });

  it('are added after 42 confirms the login AND the owner confirms the rights', async () => {
    renderPanels();
    fireEvent.change(screen.getByLabelText('Ajouter un propriétaire (login 42)'), {
      target: { value: 'carol' },
    });
    click('Ajouter');

    expect(await screen.findByText('Ajouter carol comme propriétaire ?')).toBeInTheDocument();
    expect(screen.getByText(/aura tous les droits/)).toBeInTheDocument();
    expect(mocks.addOwner).not.toHaveBeenCalled();

    click('Ajouter comme propriétaire');
    await waitFor(() =>
      expect(mocks.addOwner).toHaveBeenCalledWith({ login: 'carol', acceptUnverified: false }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Enregistré'));
  });

  it('warns that 42 could not confirm a login, and sends the owner’s yes with it', async () => {
    mocks.checkOwner.mockResolvedValue({ ok: true, login: 'carol', status: 'unknown' });
    renderPanels();
    fireEvent.change(screen.getByLabelText('Ajouter un propriétaire (login 42)'), {
      target: { value: 'carol' },
    });
    click('Ajouter');
    expect(
      await screen.findByText(/42 n'a pas pu confirmer que ce login existe/),
    ).toBeInTheDocument();
    click('Ajouter comme propriétaire');
    await waitFor(() =>
      expect(mocks.addOwner).toHaveBeenCalledWith({ login: 'carol', acceptUnverified: true }),
    );
  });

  it('refuses a login that does not exist before any confirmation', async () => {
    mocks.checkOwner.mockResolvedValue({ ok: false, code: 'loginMissing', field: 'login' });
    renderPanels();
    fireEvent.change(screen.getByLabelText('Ajouter un propriétaire (login 42)'), {
      target: { value: 'nobody' },
    });
    click('Ajouter');
    expect(await screen.findByText(/n'existe pas sur l'intra/)).toBeInTheDocument();
    expect(screen.queryByText(/comme propriétaire \?/)).toBeNull();
  });

  it('shows the server’s refusal of an addition as an error, not as "saved"', async () => {
    mocks.addOwner.mockResolvedValue({ ok: false, code: 'ownerExists', field: 'login' });
    renderPanels();
    fireEvent.change(screen.getByLabelText('Ajouter un propriétaire (login 42)'), {
      target: { value: 'carol' },
    });
    click('Ajouter');
    await screen.findByText('Ajouter carol comme propriétaire ?');
    click('Ajouter comme propriétaire');
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Ce login est déjà propriétaire.'),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
