import type { ReactNode } from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import type { DraftView } from '@/lib/setup/draft';

/**
 * The installer's screens, with the real French messages and the server actions played: what a person sees,
 * and what is sent to the server when they click.
 */

// The default wait (1 s) is short for a slow CI runner: these screens run server actions through transitions.
configure({ asyncUtilTimeout: 5000 });

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  submitCode: vi.fn(),
  saveIdentity: vi.fn(),
  saveAddress: vi.fn(),
  verifyFortyTwo: vi.fn(),
  skipFortyTwoVerification: vi.fn(),
  loadCampuses: vi.fn(),
  saveCampuses: vi.fn(),
  checkOwner: vi.fn(),
  saveOwners: vi.fn(),
  saveModules: vi.fn(),
  saveNotifications: vi.fn(),
  testNotification: vi.fn(),
  finishInstallation: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/[locale]/setup/actions', () => ({
  submitCode: mocks.submitCode,
  saveIdentity: mocks.saveIdentity,
  saveAddress: mocks.saveAddress,
  verifyFortyTwo: mocks.verifyFortyTwo,
  skipFortyTwoVerification: mocks.skipFortyTwoVerification,
  loadCampuses: mocks.loadCampuses,
  saveCampuses: mocks.saveCampuses,
  checkOwner: mocks.checkOwner,
  saveOwners: mocks.saveOwners,
  saveModules: mocks.saveModules,
  saveNotifications: mocks.saveNotifications,
  testNotification: mocks.testNotification,
  finishInstallation: mocks.finishInstallation,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { CodeForm } = await import('./code-form');
const { SetupWizard } = await import('./wizard');

const view = (patch: Partial<DraftView> = {}): DraftView => ({
  step: 0,
  name: '',
  accentColor: '#0f766e',
  messageLocale: 'fr',
  addressUrl: 'http://localhost:3500',
  clientId: '',
  hasClientSecret: false,
  credentialsVerified: false,
  credentialsSkipped: false,
  campuses: [],
  mainCampus: '',
  timezone: '',
  owners: [],
  events: true,
  notifications: {
    mode: 'none',
    hasDiscordWebhook: false,
    hasSlackWebhook: false,
    smtp: { host: '', port: '587', user: '', from: '', hasPassword: false },
  },
  ...patch,
});

function renderWizard(initial: DraftView) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <SetupWizard
        initial={initial}
        locale="fr"
        brand={<span>brand</span>}
        switcher={<span>English</span>}
      />
    </NextIntlClientProvider>,
  );
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCampuses.mockResolvedValue({
    ok: true,
    campuses: [
      { name: 'Nice', country: 'France', timeZone: 'Europe/Paris' },
      { name: 'Montréal', country: 'Canada', timeZone: 'America/Montreal' },
    ],
  });
  for (const name of [
    'saveIdentity',
    'saveAddress',
    'saveCampuses',
    'saveOwners',
    'saveModules',
    'saveNotifications',
  ] as const) {
    mocks[name].mockResolvedValue({ ok: true });
  }
  mocks.saveAddress.mockResolvedValue({
    ok: true,
    url: 'http://localhost:3500',
    redirectUrl: 'http://localhost:3500/api/auth/callback/42-school',
  });
});
afterEach(cleanup);

describe('the code screen', () => {
  const renderCode = () =>
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <CodeForm />
      </NextIntlClientProvider>,
    );

  it('says where the code is, and sends it in capitals', async () => {
    mocks.submitCode.mockResolvedValue({ ok: true });
    renderCode();
    expect(screen.getByText(/docker compose logs app/)).toBeInTheDocument();
    expect(screen.getByText(/onglet Logs/)).toBeInTheDocument();

    type("Code d'installation", 'k7qm-4xpd');
    click('Continuer');

    await waitFor(() => expect(mocks.submitCode).toHaveBeenCalledWith('K7QM-4XPD'));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it('refuses to send nothing', () => {
    renderCode();
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
  });

  it('says the code is wrong, and empties the field', async () => {
    mocks.submitCode.mockResolvedValue({ ok: false, code: 'wrong' });
    renderCode();
    type("Code d'installation", 'AAAA-AAAA');
    click('Continuer');
    expect(await screen.findByRole('alert')).toHaveTextContent("Ce code n'est pas le bon");
    expect(screen.getByLabelText("Code d'installation")).toHaveValue('');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('says how long to wait when the entry is locked', async () => {
    mocks.submitCode.mockResolvedValue({ ok: false, code: 'locked', retryAfterSeconds: 30 });
    renderCode();
    type("Code d'installation", 'AAAA-AAAA');
    click('Continuer');
    expect(await screen.findByRole('alert')).toHaveTextContent('Réessayez dans 30 secondes');
  });
});

describe('the wizard', () => {
  it('opens on the first step, with a progress bar of the 8 steps', () => {
    renderWizard(view());
    expect(screen.getByRole('heading', { name: 'Votre BDE' })).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '8');
    expect(bar.getAttribute('aria-valuetext')).toContain('Étape 1 sur 8');
    expect(screen.queryByRole('button', { name: 'Retour' })).toBeNull();
  });

  it('opens on the step the person had reached (a reload loses nothing)', () => {
    renderWizard(view({ step: 4, name: 'BDE Test' }));
    expect(screen.getByRole('heading', { name: 'Propriétaires' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  });

  it('saves a step, moves on, and can come back with what was typed', async () => {
    renderWizard(view());
    type('Nom du BDE', 'BDE Test');
    click('Continuer');

    expect(
      await screen.findByRole('heading', { name: 'Adresse de la plateforme' }),
    ).toBeInTheDocument();
    expect(mocks.saveIdentity).toHaveBeenCalledWith({
      name: 'BDE Test',
      accentColor: '#0f766e',
      messageLocale: 'fr',
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');

    click('Retour');
    expect(await screen.findByRole('heading', { name: 'Votre BDE' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du BDE')).toHaveValue('BDE Test');
  });

  it('puts the error of the server under the field and stays on the step', async () => {
    mocks.saveIdentity.mockResolvedValue({ ok: false, code: 'name', field: 'name' });
    renderWizard(view());
    click('Continuer');
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 et 60 caractères');
    expect(screen.getByRole('heading', { name: 'Votre BDE' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du BDE')).toHaveAttribute('aria-invalid', 'true');
  });

  it('goes back to the code when the session of the installer is over', async () => {
    mocks.saveIdentity.mockResolvedValue({ ok: false, code: 'session' });
    renderWizard(view());
    click('Continuer');
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  describe('the address', () => {
    it('warns about plain http on a real domain, and sends the yes of the person', async () => {
      renderWizard(view({ step: 1, addressUrl: 'http://bde.exemple.fr' }));
      expect(screen.getByRole('alert')).toHaveTextContent('non chiffrée');

      fireEvent.click(screen.getByLabelText(/Je comprends/));
      click('Continuer');
      await waitFor(() =>
        expect(mocks.saveAddress).toHaveBeenCalledWith({
          address: 'http://bde.exemple.fr',
          acceptInsecure: true,
        }),
      );
    });

    it('does not warn about a try-out on this computer', () => {
      renderWizard(view({ step: 1 }));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('the 42 application', () => {
    const open = () => renderWizard(view({ step: 2, addressUrl: 'https://bde.exemple.fr' }));

    it('gives the exact address to declare, step by step', () => {
      open();
      expect(
        screen.getByDisplayValue('https://bde.exemple.fr/api/auth/callback/42-school'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Register a new App/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Ouvrir l'intra 42/ })).toHaveAttribute(
        'href',
        'https://profile.intra.42.fr/oauth/applications',
      );
    });

    it('asks 42, with the secret in a password field', async () => {
      mocks.verifyFortyTwo.mockResolvedValue({ ok: true });
      open();
      expect(screen.getByLabelText('SECRET (clé secrète)')).toHaveAttribute('type', 'password');
      type('UID (identifiant)', 'u-s4t2ud-uid-abcdef');
      type('SECRET (clé secrète)', 's-s4t2ud-secret-abcdef');
      click('Vérifier avec 42');

      await waitFor(() =>
        expect(mocks.verifyFortyTwo).toHaveBeenCalledWith({
          clientId: 'u-s4t2ud-uid-abcdef',
          clientSecret: 's-s4t2ud-secret-abcdef',
        }),
      );
      expect(await screen.findByRole('heading', { name: 'Campus' })).toBeInTheDocument();
    });

    it('says 42 refuses the pair, and stays', async () => {
      mocks.verifyFortyTwo.mockResolvedValue({
        ok: false,
        code: 'invalidCredentials',
        field: 'clientSecret',
      });
      open();
      click('Vérifier avec 42');
      expect(await screen.findByRole('alert')).toHaveTextContent('42 refuse ces identifiants');
      expect(screen.getByRole('heading', { name: 'Application 42' })).toBeInTheDocument();
    });

    it('offers to go on without the check when 42 cannot be reached', async () => {
      mocks.verifyFortyTwo.mockResolvedValue({ ok: false, code: 'network', detail: 'ENOTFOUND' });
      mocks.skipFortyTwoVerification.mockResolvedValue({ ok: true });
      open();
      click('Vérifier avec 42');

      expect(await screen.findByText(/42 ne répond pas depuis cet ordinateur/)).toBeInTheDocument();
      expect(screen.getByText(/ENOTFOUND/)).toBeInTheDocument();
      // the button is disabled while the first answer is still being settled: a slow runner clicks too early
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continuer sans vérifier' })).toBeEnabled(),
      );
      click('Continuer sans vérifier');
      await waitFor(() => expect(mocks.skipFortyTwoVerification).toHaveBeenCalled());
    });

    it('never has the secret back: a saved one is only said to be there', () => {
      renderWizard(
        view({
          step: 2,
          clientId: 'u-s4t2ud-uid-abcdef',
          hasClientSecret: true,
          credentialsVerified: true,
        }),
      );
      expect(screen.getByLabelText('SECRET (clé secrète)')).toHaveValue('');
      expect(screen.getByText(/déjà enregistrée/)).toBeInTheDocument();
      expect(screen.getByText('42 a accepté ces identifiants.')).toBeInTheDocument();
    });
  });

  describe('the campuses', () => {
    it('are searched in the list of 42 (accents ignored), and the first one chosen is the BDE’s', async () => {
      renderWizard(view({ step: 3 }));
      await screen.findByLabelText('Rechercher un campus');

      type('Rechercher un campus', 'montreal');
      fireEvent.click(await screen.findByRole('button', { name: /Montréal/ }));
      expect(screen.getByLabelText('Campus de votre BDE')).toHaveValue('Montréal');
      expect(screen.getByLabelText('Fuseau horaire')).toHaveValue('America/Montreal');

      click('Continuer');
      await waitFor(() =>
        expect(mocks.saveCampuses).toHaveBeenCalledWith({
          campuses: ['Montréal'],
          mainCampus: 'Montréal',
          timezone: 'America/Montreal',
        }),
      );
    });

    it('can be every campus, and then none is sent', async () => {
      renderWizard(view({ step: 3 }));
      await screen.findByLabelText('Rechercher un campus');
      fireEvent.click(screen.getByLabelText(/Autoriser tous les campus/));
      fireEvent.change(screen.getByLabelText('Campus de votre BDE'), { target: { value: 'Nice' } });
      click('Continuer');
      await waitFor(() =>
        expect(mocks.saveCampuses).toHaveBeenCalledWith(
          expect.objectContaining({ campuses: [], mainCampus: 'Nice' }),
        ),
      );
    });

    it('are typed by hand when 42 gives no list', async () => {
      mocks.loadCampuses.mockResolvedValue({ ok: true, campuses: null });
      renderWizard(view({ step: 3 }));
      expect(await screen.findByText(/n'a pas pu être chargée/)).toBeInTheDocument();
      type('Nom du campus', 'Nice');
      fireEvent.keyDown(screen.getByLabelText('Nom du campus'), { key: 'Enter' });
      expect(screen.getByLabelText('Campus de votre BDE')).toHaveValue('Nice');
    });
  });

  describe('the owners', () => {
    const open = () => renderWizard(view({ step: 4 }));

    it('are added once 42 confirms the login, and at least one is needed', async () => {
      mocks.checkOwner.mockResolvedValue({ ok: true, login: 'alice', status: 'exists' });
      open();
      click('Continuer');
      expect(await screen.findByRole('alert')).toHaveTextContent('au moins un propriétaire');
      expect(mocks.saveOwners).not.toHaveBeenCalled();

      type('Login 42', 'Alice');
      click('Ajouter');
      expect(await screen.findByText('alice')).toBeInTheDocument();
      click('Continuer');
      await waitFor(() => expect(mocks.saveOwners).toHaveBeenCalledWith({ owners: ['alice'] }));
    });

    it('says a login does not exist, and does not add it', async () => {
      mocks.checkOwner.mockResolvedValue({ ok: false, code: 'loginMissing', field: 'login' });
      open();
      type('Login 42', 'nobody');
      click('Ajouter');
      expect(await screen.findByText(/n'existe pas sur l'intra/)).toBeInTheDocument();
      expect(screen.getByText("Aucun propriétaire pour l'instant.")).toBeInTheDocument();
    });

    it('asks before adding a login that 42 could not check', async () => {
      mocks.checkOwner.mockResolvedValue({ ok: true, login: 'alice', status: 'unknown' });
      open();
      type('Login 42', 'alice');
      click('Ajouter');
      expect(await screen.findByText('Impossible de vérifier ce login')).toBeInTheDocument();
      click(/Ajouter quand même/);
      expect(await screen.findByRole('button', { name: 'Retirer alice' })).toBeInTheDocument();
    });

    it('can be removed', async () => {
      renderWizard(view({ step: 4, owners: ['alice', 'bob'] }));
      click('Retirer alice');
      expect(screen.queryByRole('button', { name: 'Retirer alice' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Retirer bob' })).toBeInTheDocument();
    });
  });

  describe('the notifications', () => {
    it('start with nothing, and show only the fields of the channel chosen', () => {
      renderWizard(view({ step: 6 }));
      expect(screen.getByLabelText(/Aucune pour l'instant/)).toBeChecked();
      expect(screen.queryByLabelText('Adresse du webhook Discord')).toBeNull();

      fireEvent.click(screen.getByLabelText(/Discord/));
      expect(screen.getByLabelText('Adresse du webhook Discord')).toHaveAttribute(
        'type',
        'password',
      );
      expect(
        screen.getByRole('button', { name: 'Envoyer un message de test' }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText(/E-mail/));
      expect(screen.getByLabelText('Serveur SMTP')).toBeInTheDocument();
      expect(screen.getByLabelText('Envoyer le test à')).toBeInTheDocument();
    });

    it('send a test message and say how it went, with the reason', async () => {
      mocks.testNotification.mockResolvedValueOnce({ ok: true });
      mocks.testNotification.mockResolvedValueOnce({
        ok: false,
        code: 'testFailed',
        detail: 'HTTP 404',
      });
      renderWizard(view({ step: 6 }));
      fireEvent.click(screen.getByLabelText(/Discord/));
      type('Adresse du webhook Discord', 'https://discord.com/api/webhooks/1/x');

      click('Envoyer un message de test');
      expect(await screen.findByText(/Message envoyé/)).toBeInTheDocument();
      expect(mocks.testNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'discord',
          discordWebhook: 'https://discord.com/api/webhooks/1/x',
        }),
        { locale: 'fr', to: '' },
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Envoyer un message de test' })).toBeEnabled(),
      );
      click('Envoyer un message de test');
      expect(await screen.findByText(/L'envoi a échoué \(HTTP 404\)/)).toBeInTheDocument();
    });
  });

  describe('the end', () => {
    const full = () =>
      view({
        step: 7,
        name: 'BDE Test',
        addressUrl: 'https://bde.exemple.fr',
        clientId: 'u-s4t2ud-uid-abcdef',
        hasClientSecret: true,
        credentialsVerified: true,
        campuses: ['Nice'],
        mainCampus: 'Nice',
        timezone: 'Europe/Paris',
        owners: ['alice'],
      });

    it('sums everything up, without any secret', () => {
      renderWizard(full());
      expect(screen.getByRole('heading', { name: 'Récapitulatif' })).toBeInTheDocument();
      for (const shown of ['BDE Test', 'https://bde.exemple.fr', 'Nice', 'alice', 'activés']) {
        expect(screen.getAllByText(new RegExp(shown)).length).toBeGreaterThan(0);
      }
      expect(screen.getByText(/enregistrée, chiffrée/)).toBeInTheDocument();
      expect(screen.getByText(/vérifiée par 42/)).toBeInTheDocument();
    });

    it('installs, then says the platform is installed and where to sign in', async () => {
      mocks.finishInstallation.mockResolvedValue({ ok: true });
      renderWizard(full());
      click('Installer la plateforme');

      expect(
        await screen.findByRole('heading', { name: 'Plateforme installée' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Se connecter avec 42' })).toHaveAttribute(
        'href',
        '/fr',
      );
      // what to do now: the background mode, and the backup of the keys
      expect(screen.getByText(/docker compose up -d/)).toBeInTheDocument();
      expect(screen.getByText(/volume « secrets »/)).toBeInTheDocument();
      // no progress bar, and no language switch (it would lead to the installer, which is gone)
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('English')).toBeNull();
    });

    it('stays on the summary and says why when the installation is refused', async () => {
      mocks.finishInstallation.mockResolvedValue({ ok: false, code: 'incomplete' });
      renderWizard(full());
      click('Installer la plateforme');
      expect(await screen.findByRole('alert')).toHaveTextContent('Il manque une réponse');
      expect(screen.getByRole('heading', { name: 'Récapitulatif' })).toBeInTheDocument();
    });
  });
});
