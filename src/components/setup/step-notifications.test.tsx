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
import type { DraftView } from '@/lib/setup/draft';
import { emptyMatrix } from '@/lib/setup/notifications';
import type { StepApi } from './api';
import { StepNotifications } from './step-notifications';

/**
 * The table of the notifications, with the real French messages: what can be ticked, what the shortcuts do, what is sent when
 * the person saves, and what each test says. It is the one component of the installer and of the settings page.
 */

configure({ asyncUtilTimeout: 5000 });

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/secret-part';

const api = {
  saveNotifications: vi.fn(),
  testNotification: vi.fn(),
} satisfies Partial<Record<keyof StepApi, unknown>>;

const notificationsView = (
  patch: Partial<DraftView['notifications']> = {},
): DraftView['notifications'] => ({
  matrix: emptyMatrix(),
  hasDiscordWebhook: false,
  hasSlackWebhook: false,
  hasSmtp: false,
  smtp: { host: '', port: '587', user: '', from: '', hasPassword: false },
  ...patch,
});

const draft = (patch: Partial<DraftView['notifications']> = {}, events = true): DraftView =>
  ({ events, notifications: notificationsView(patch) }) as DraftView;

const onSaved = vi.fn();
const onNext = vi.fn();

function renderStep(view: DraftView) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <StepNotifications
        api={api as unknown as StepApi}
        view={view}
        onSaved={onSaved}
        run={(promise) => promise}
        onNext={onNext}
      />
    </NextIntlClientProvider>,
  );
}

const box = (type: string, channel: string) =>
  screen.getByRole('checkbox', { name: `${type} — ${channel}` });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

beforeEach(() => {
  vi.clearAllMocks();
  api.saveNotifications.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('a table with a row per notification and a column per channel', () => {
  it('has the ten rows, the three channels, and no box that can be ticked before a channel is set up', () => {
    renderStep(draft());
    expect(screen.getAllByRole('checkbox')).toHaveLength(10 * 3 - 1); // no e-mail for a member removed
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
      expect(checkbox).not.toBeChecked();
    }
    for (const name of ['Discord', 'Slack', 'E-mail']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('shows no e-mail box for a member who was removed, and says why', () => {
    renderStep(draft());
    expect(
      screen.queryByRole('checkbox', { name: 'Membre retiré — E-mail' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Jamais d'e-mail").length).toBeGreaterThanOrEqual(1);
  });

  it('hides the rows of the events module when it is off, and keeps what they hold', async () => {
    const matrix = { ...emptyMatrix(), eventConfirmed: ['discord' as const] };
    renderStep(draft({ matrix, hasDiscordWebhook: true }, false));
    expect(screen.queryByRole('checkbox', { name: /Événement confirmé/ })).not.toBeInTheDocument();
    // the members' and the backups': the owners are told whatever the modules
    expect(screen.getAllByRole('checkbox')).toHaveLength(5 * 3 - 1);

    save();
    await waitFor(() => expect(api.saveNotifications).toHaveBeenCalled());
    expect(api.saveNotifications.mock.calls[0]?.[0].matrix.eventConfirmed).toEqual(['discord']);
  });
});

describe('a channel has to be set up before it can be ticked', () => {
  it('typing a Discord address makes its column tickable, and only its', () => {
    renderStep(draft());
    type('Adresse du webhook Discord', WEBHOOK);
    expect(box("Demande d'accès en attente", 'Discord')).toBeEnabled();
    expect(box("Demande d'accès en attente", 'Slack')).toBeDisabled();
    expect(box("Demande d'accès en attente", 'E-mail')).toBeDisabled();
    fireEvent.click(box("Demande d'accès en attente", 'Discord'));
    expect(box("Demande d'accès en attente", 'Discord')).toBeChecked();
  });

  it('a channel already saved is tickable at once, and says it is set up', () => {
    renderStep(draft({ hasSlackWebhook: true }));
    expect(box('Événement confirmé', 'Slack')).toBeEnabled();
    const panel = screen.getByRole('region', { name: 'Slack' });
    // the badge of the panel, and the address itself, which is not shown
    expect(within(panel).getAllByText('Configuré')).toHaveLength(2);
    expect(within(panel).queryByRole('textbox', { name: 'Adresse du webhook Slack' })).toBeNull();
  });

  it('the mail server needs its host and its sender', () => {
    renderStep(draft());
    type('Serveur SMTP', 'smtp.exemple.fr');
    expect(box("Demande d'accès en attente", 'E-mail')).toBeDisabled();
    type("Adresse d'expéditeur", 'bde@exemple.fr');
    expect(box("Demande d'accès en attente", 'E-mail')).toBeEnabled();
  });
});

describe('the shortcuts of a column', () => {
  it('are off for a channel that is not set up', () => {
    renderStep(draft());
    expect(screen.getByRole('button', { name: 'Discord : tout cocher' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'E-mail : tout cocher' })).toBeDisabled();
  });

  it('tick a whole column, then clear it, the button saying which', () => {
    renderStep(draft({ hasDiscordWebhook: true, hasSmtp: true }));
    press('Discord : tout cocher');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Discord : tout décocher' })).toBeInTheDocument();

    press('E-mail : tout cocher');
    // 9: the e-mail of a member removed does not exist
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(10 + 9);

    press('Discord : tout décocher');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(9);
  });

  it('clear every box at once', () => {
    renderStep(draft({ hasDiscordWebhook: true, hasSlackWebhook: true }));
    press('Discord : tout cocher');
    press('Slack : tout cocher');
    press('Tout décocher');
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  });
});

describe('saving', () => {
  it('sends the table, the addresses typed and nothing for a channel that is not set up', async () => {
    renderStep(draft());
    type('Adresse du webhook Discord', WEBHOOK);
    fireEvent.click(box("Demande d'accès en attente", 'Discord'));
    fireEvent.click(box('Événement confirmé', 'Discord'));
    save();

    await waitFor(() => expect(api.saveNotifications).toHaveBeenCalledTimes(1));
    const sent = api.saveNotifications.mock.calls[0]?.[0];
    expect(sent.matrix.memberPending).toEqual(['discord']);
    expect(sent.matrix.eventConfirmed).toEqual(['discord']);
    expect(sent.matrix.eventReminder).toEqual([]);
    expect(sent.discordWebhook).toBe(WEBHOOK);
    expect(sent.removed).toEqual([]);
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith({
      notifications: expect.objectContaining({
        hasDiscordWebhook: true,
        hasSlackWebhook: false,
        matrix: expect.objectContaining({ memberPending: ['discord'] }),
      }),
    });
  });

  it('shows the refusal of a box, under the table, and does not go on', async () => {
    api.saveNotifications.mockResolvedValue({
      ok: false,
      code: 'channelNotConfigured',
      field: 'matrix',
    });
    renderStep(draft({ hasDiscordWebhook: true }));
    press('Discord : tout cocher');
    save();
    expect(await screen.findByText(/canal qui n'est pas configuré/)).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('nothing ticked is valid: no notification at all', async () => {
    renderStep(draft());
    save();
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(Object.values(api.saveNotifications.mock.calls[0]?.[0].matrix).flat()).toEqual([]);
  });
});

describe('removing a channel', () => {
  it('is marked, not done: its boxes clear, it can be kept again, and the Save button sends it', async () => {
    renderStep(
      draft({ hasDiscordWebhook: true, matrix: { ...emptyMatrix(), memberPending: ['discord'] } }),
    );
    expect(box("Demande d'accès en attente", 'Discord')).toBeChecked();

    press('Retirer Discord');
    expect(screen.getByText(/Discord sera retiré à l’enregistrement/)).toBeInTheDocument();
    expect(box("Demande d'accès en attente", 'Discord')).toBeDisabled();
    expect(box("Demande d'accès en attente", 'Discord')).not.toBeChecked();

    press('Garder Discord');
    expect(box("Demande d'accès en attente", 'Discord')).toBeEnabled();
    expect(box("Demande d'accès en attente", 'Discord')).toBeChecked();

    press('Retirer Discord');
    save();
    await waitFor(() => expect(api.saveNotifications).toHaveBeenCalled());
    const sent = api.saveNotifications.mock.calls[0]?.[0];
    expect(sent.removed).toEqual(['discord']);
    expect(sent.matrix.memberPending).toEqual([]);
  });

  it('is offered only for a channel that has something saved', () => {
    renderStep(draft({ hasDiscordWebhook: true }));
    expect(screen.getByRole('button', { name: 'Retirer Discord' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirer Slack' })).not.toBeInTheDocument();
  });
});

describe('the test of a channel', () => {
  it('goes through that channel only, and says how it went in its own panel', async () => {
    api.testNotification.mockResolvedValue({ ok: true });
    renderStep(draft({ hasSlackWebhook: true, hasDiscordWebhook: true }));
    press('Envoyer un test sur Slack');

    const panel = screen.getByRole('region', { name: 'Slack' });
    expect(await within(panel).findByText(/Test envoyé sur Slack/)).toBeInTheDocument();
    expect(api.testNotification).toHaveBeenCalledWith(expect.anything(), {
      locale: 'fr',
      channel: 'slack',
      to: '',
    });
    expect(
      within(screen.getByRole('region', { name: 'Discord' })).queryByText(/Test envoyé/),
    ).not.toBeInTheDocument();
  });

  it('says why it failed, in the panel of the channel', async () => {
    api.testNotification.mockResolvedValue({ ok: false, code: 'testFailed', detail: 'HTTP 404' });
    renderStep(draft({ hasDiscordWebhook: true }));
    press('Envoyer un test sur Discord');
    expect(await screen.findByText(/L'envoi a échoué \(HTTP 404\)/)).toBeInTheDocument();
  });

  it('is off for a channel that is not set up, and the e-mail asks where to send it', async () => {
    api.testNotification.mockResolvedValue({ ok: true });
    renderStep(draft());
    expect(screen.getByRole('button', { name: 'Envoyer un test sur Slack' })).toBeDisabled();
    expect(screen.queryByLabelText('Envoyer le test à')).not.toBeInTheDocument();

    type('Serveur SMTP', 'smtp.exemple.fr');
    type("Adresse d'expéditeur", 'bde@exemple.fr');
    type('Envoyer le test à', 'me@exemple.fr');
    press('Envoyer un test sur E-mail');
    await waitFor(() => expect(api.testNotification).toHaveBeenCalled());
    expect(api.testNotification.mock.calls[0]?.[1]).toEqual({
      locale: 'fr',
      channel: 'email',
      to: 'me@exemple.fr',
    });
  });
});

describe('the notifications about the publication on the intra', () => {
  const withIntra = (patch: Partial<DraftView['notifications']> = {}, events = true): DraftView =>
    ({ events, intra: true, notifications: notificationsView(patch) }) as DraftView;

  it('are five more rows, only when the events module is on and the platform publishes on the intra', () => {
    renderStep(withIntra());
    expect(screen.getAllByRole('checkbox')).toHaveLength(15 * 3 - 1);
    expect(screen.getByText("Publication sur l'intra")).toBeInTheDocument();
    for (const name of [
      'Publication demandée',
      "Événement modifié sur l'intra",
      "Événement retiré de l'intra",
      "Publié sur l'intra",
      'Publication refusée',
    ]) {
      expect(screen.getByRole('checkbox', { name: `${name} — Discord` })).toBeInTheDocument();
    }
  });

  it('are not offered while the platform does not publish on the intra, nor without the events module', () => {
    renderStep(draft());
    expect(
      screen.queryByRole('checkbox', { name: /Publication demandée/ }),
    ).not.toBeInTheDocument();
    cleanup();
    renderStep(withIntra({}, false));
    expect(
      screen.queryByRole('checkbox', { name: /Publication demandée/ }),
    ).not.toBeInTheDocument();
  });

  it('are ticked like the others, and a column shortcut reaches them too', async () => {
    renderStep(withIntra({ hasDiscordWebhook: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Discord : tout cocher' }));
    expect(box('Publication demandée', 'Discord')).toBeChecked();
    expect(box("Publié sur l'intra", 'Discord')).toBeChecked();

    save();
    await waitFor(() => expect(api.saveNotifications).toHaveBeenCalled());
    const matrix = api.saveNotifications.mock.calls[0]?.[0].matrix;
    expect(matrix.intraRequested).toEqual(['discord']);
    expect(matrix.intraRefused).toEqual(['discord']);
  });

  it('keep what they hold when the table does not show them', async () => {
    const matrix = { ...emptyMatrix(), intraChanged: ['discord' as const] };
    renderStep(draft({ matrix, hasDiscordWebhook: true }));
    save();
    await waitFor(() => expect(api.saveNotifications).toHaveBeenCalled());
    expect(api.saveNotifications.mock.calls[0]?.[0].matrix.intraChanged).toEqual(['discord']);
  });
});
