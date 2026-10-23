import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorData, ScopeState } from '@/lib/notifications/templates/editor-data';
import type { ChannelDefaults } from '@/lib/notifications/templates/defaults-shape';
import type { TemplateContent } from '@/lib/notifications/templates/types';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';

const actions = vi.hoisted(() => ({
  acknowledgeRevision: vi.fn(),
  customizeChannel: vi.fn(),
  previewTemplate: vi.fn(),
  resetNotification: vi.fn(),
  resetTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  sendTemplateTestMessage: vi.fn(),
  loadHistory: vi.fn(),
  restoreVersion: vi.fn(),
  addMention: vi.fn(),
  removeMention: vi.fn(),
}));
vi.mock('@/app/[locale]/(app)/notifications/actions', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TemplateEditor } = await import('./template-editor');
const { toast } = await import('sonner');

afterEach(cleanup);

const DISCORD: ChannelDefaults = {
  eyebrow: 'Nouvel événement confirmé',
  title: '{title}',
  emoji: '🎉',
  footer: 'BDE_Network',
  button: { label: "Voir l'événement", native: false },
  items: {
    when: { label: 'Quand', emoji: '📅' },
    repeats: { label: 'Répétition', emoji: '🔁' },
    where: { label: 'Où', emoji: '📍' },
    description: {},
    category: { label: 'Catégorie', emoji: '🏷️' },
    assignees: { label: 'Membres en charge', emoji: '👥' },
  },
};
const COMMON: ChannelDefaults = {
  ...DISCORD,
  emoji: '',
  footer: '',
  button: { label: "Voir l'événement", native: true },
  items: {
    when: { label: 'Quand' },
    repeats: { label: 'Répétition' },
    where: { label: 'Où' },
    description: {},
    category: { label: 'Catégorie' },
    assignees: { label: 'Membres en charge' },
  },
};
const EMAIL: ChannelDefaults = {
  ...COMMON,
  footer: 'Vous recevez ce message car vous êtes membre de {bde}.',
  subject: 'Nouvel événement : {title}',
};

const none = (): ScopeState => ({
  content: null,
  version: 0,
  updatedByLogin: null,
  updatedAt: null,
  fallback: null,
  outdated: [],
});
const scope = (content: TemplateContent, version = 1): ScopeState => ({
  ...none(),
  content,
  version,
  updatedByLogin: 'paula',
  updatedAt: '2026-10-22T10:00:00.000Z',
});

function dataWith(scopes: Partial<EditorData['scopes']> = {}): EditorData {
  return {
    type: 'eventConfirmed',
    locale: 'fr',
    channels: ['discord', 'slack', 'email'],
    shared: ['discord', 'slack', 'email'],
    ticked: ['discord', 'email'],
    scopes: { all: none(), discord: none(), slack: none(), email: none(), ...scopes },
    defaults: { all: COMMON, discord: DISCORD, slack: COMMON, email: EMAIL },
    items: ['when', 'repeats', 'where', 'description', 'category', 'assignees'],
    nativeOrder: {
      discord: ['when', 'where', 'description', 'category', 'assignees', 'repeats'],
      slack: ['description', 'when', 'where', 'category', 'assignees', 'repeats'],
      email: ['description', 'when', 'repeats', 'where', 'category', 'assignees'],
    },
    variables: [
      { id: 'title', sample: 'Soirée de rentrée' },
      { id: 'place', sample: 'Foyer' },
      { id: 'bde', sample: 'BDE Nice' },
    ],
    mentions: [],
    bde: { name: 'BDE Nice', accent: '#2f5bea' },
  };
}

const PREVIEW = {
  ok: true,
  preview: {
    channel: 'discord',
    embed: { title: 'Soirée de rentrée', description: '-# NOUVEL ÉVÉNEMENT CONFIRMÉ' },
  },
};

function renderEditor(
  data: EditorData = dataWith(),
  extra: { initialScope?: 'all' | 'discord' | 'slack' | 'email'; locale?: 'fr' | 'en' } = {},
) {
  const locale = extra.locale ?? 'fr';
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <TemplateEditor
        data={data}
        initialScope={extra.initialScope ?? 'all'}
        notice={null}
        testable={{ discord: true, slack: false, email: true }}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
  actions.previewTemplate.mockResolvedValue(PREVIEW);
  actions.saveTemplate.mockResolvedValue({ ok: true, version: 1, changed: true });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

const saveButton = () => screen.getByRole('button', { name: 'Enregistrer' });

describe('the editor of a notification', () => {
  it('offers a tab for all the channels and one for each', async () => {
    renderEditor();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Tous les canaux', 'Discord', 'Slack', 'E-mail']);
    expect(screen.getByRole('tab', { name: 'Tous les canaux' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(actions.previewTemplate).toHaveBeenCalled());
  });

  it('shows the platform’s own words, with the variables named in the language of the interface', () => {
    renderEditor();
    expect(screen.getByLabelText('Titre')).toHaveValue('{titre}');
    expect(screen.getByLabelText('Petit texte au-dessus du titre')).toHaveValue(
      'Nouvel événement confirmé',
    );
    expect(saveButton()).toBeDisabled();
  });

  it('stores what is typed with the identifiers of the variables, and saves it against the version it was read at', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Ce soir : {titre} !' } });
    expect(screen.getByLabelText('Titre')).toHaveValue('Ce soir : {titre} !');
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(actions.saveTemplate).toHaveBeenCalledWith({
        type: 'eventConfirmed',
        scope: 'all',
        content: { title: 'Ce soir : {title} !' },
        expectedVersion: 0,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Modèle enregistré'));
    // saved: nothing left to save
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it('asks the server to draw the preview of what is typed, after a short pause', async () => {
    renderEditor();
    await waitFor(() => expect(actions.previewTemplate).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'AB' } });
    await waitFor(() => expect(actions.previewTemplate).toHaveBeenCalledTimes(2));
    expect(actions.previewTemplate).toHaveBeenLastCalledWith({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { all: { title: 'AB' }, own: null },
    });
  });

  it('says a template has an error, keeps the last good picture and does not test it', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('preview-discord')).toBeInTheDocument());
    actions.previewTemplate.mockResolvedValue({
      ok: false,
      code: 'invalid',
      issues: [{ path: 'title', code: 'unknownVariable', params: { variable: 'inconnue' } }],
    });
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: '{inconnue}' } });
    await screen.findByText(/dernière version valide/);
    expect(screen.getByTestId('preview-discord')).toBeInTheDocument();
    expect(screen.getByText('Variable inconnue : inconnue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Envoyer un test sur Discord/ })).toBeDisabled();
  });

  it('says another save came first, and offers to reload', async () => {
    actions.saveTemplate.mockResolvedValue({ ok: false, code: 'conflict' });
    renderEditor();
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'X' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Quelqu'un a enregistré avant")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeInTheDocument();
  });

  it('shows the problems the server found in a field, under it', async () => {
    actions.saveTemplate.mockResolvedValue({
      ok: false,
      code: 'invalid',
      issues: [{ path: 'button.url', code: 'badUrl' }],
    });
    renderEditor();
    fireEvent.change(screen.getByLabelText('Adresse du bouton'), { target: { value: 'http://x' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/doit commencer par https/)).toBeInTheDocument();
  });
});

describe('a channel', () => {
  it('follows the common template until it is customised: no fields, an explanation, one button', async () => {
    renderEditor(dataWith(), { initialScope: 'slack' });
    expect(screen.getByText('Slack suit le modèle commun')).toBeInTheDocument();
    expect(screen.queryByLabelText('Titre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Personnaliser ce canal' }));
    const dialog = await screen.findByRole('dialog');
    actions.customizeChannel.mockResolvedValue({ ok: false, code: 'conflict' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Personnaliser ce canal' }));
    await waitFor(() =>
      expect(actions.customizeChannel).toHaveBeenCalledWith({
        type: 'eventConfirmed',
        channel: 'slack',
      }),
    );
    expect(toast.error).toHaveBeenCalled();
  });

  it('has its own fields once customised, with the way back to the common template', () => {
    renderEditor(dataWith({ slack: scope({ title: 'Mon titre' }) }), { initialScope: 'slack' });
    expect(screen.getByLabelText('Titre')).toHaveValue('Mon titre');
    expect(screen.getByText(/Slack a son propre modèle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revenir au modèle commun' })).toBeInTheDocument();
  });

  it('previews a channel that follows with the common template alone', async () => {
    renderEditor(dataWith({ all: scope({ title: 'Commun' }) }), { initialScope: 'discord' });
    await waitFor(() => expect(actions.previewTemplate).toHaveBeenCalled());
    expect(actions.previewTemplate).toHaveBeenLastCalledWith({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { all: { title: 'Commun' }, own: null },
    });
  });

  it('says when a notification is not sent on the channel', () => {
    renderEditor(dataWith(), { initialScope: 'slack' });
    expect(screen.getByText(/n'est pas envoyée sur Slack/)).toBeInTheDocument();
  });
});

describe('the list of information', () => {
  it('lists every fact switched on, in the channel’s own order, and hides a fact when switched off', async () => {
    renderEditor(dataWith(), { initialScope: 'discord' });
    // a Discord tab has no template of its own yet: it follows
    fireEvent.click(screen.getByRole('button', { name: 'Personnaliser ce canal' }));
    cleanup();

    renderEditor(dataWith({ discord: scope({}) }), { initialScope: 'discord' });
    const items = screen.getAllByTestId(/^item-/).map((row) => row.getAttribute('data-testid'));
    expect(items).toEqual([
      'item-when',
      'item-where',
      'item-description',
      'item-category',
      'item-assignees',
      'item-repeats',
    ]);
    fireEvent.click(screen.getByRole('switch', { name: 'Lieu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(actions.saveTemplate).toHaveBeenCalled());
    const sent = actions.saveTemplate.mock.calls[0]![0] as { content: TemplateContent };
    expect(sent.content.items?.order).toBe('native');
    expect(sent.content.items?.list.find((item) => item.id === 'where')).toEqual({
      id: 'where',
      enabled: false,
    });
  });

  it('moves a fact up and stores the BDE’s order from then on', async () => {
    renderEditor(dataWith({ discord: scope({}) }), { initialScope: 'discord' });
    fireEvent.click(screen.getByRole('button', { name: 'Monter : Lieu' }));
    const items = screen.getAllByTestId(/^item-/).map((row) => row.getAttribute('data-testid'));
    expect(items.slice(0, 2)).toEqual(['item-where', 'item-when']);
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveTemplate).toHaveBeenCalled());
    const sent = actions.saveTemplate.mock.calls[0]![0] as { content: TemplateContent };
    expect(sent.content.items?.order).toBe('custom');
    expect(sent.content.items?.list.map((item) => item.id).slice(0, 2)).toEqual(['where', 'when']);
  });

  it('adds a free text, and takes it away', () => {
    renderEditor(dataWith({ discord: scope({}) }), { initialScope: 'discord' });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un texte' }));
    expect(screen.getByLabelText('Texte')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Texte'), { target: { value: 'Venez **nombreux**' } });
    fireEvent.click(screen.getByRole('button', { name: /Supprimer : Texte libre/ }));
    expect(screen.queryByLabelText('Texte')).toBeNull();
  });
});

describe('the test message', () => {
  it('is sent for the channel on screen, with the mentions inert', async () => {
    actions.sendTemplateTestMessage.mockResolvedValue({ ok: true });
    renderEditor(dataWith({ discord: scope({ above: 'Salut {@everyone}' }) }), {
      initialScope: 'discord',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer un test sur Discord' }));
    await waitFor(() =>
      expect(actions.sendTemplateTestMessage).toHaveBeenCalledWith({
        type: 'eventConfirmed',
        channel: 'discord',
        drafts: { all: null, own: { above: 'Salut {@everyone}' } },
        withMentions: false,
      }),
    );
    expect(await screen.findByText('Test envoyé sur Discord.')).toBeInTheDocument();
  });

  it('says why a channel cannot be tested, and when to try again', async () => {
    renderEditor(dataWith({ slack: scope({}) }), { initialScope: 'slack' });
    expect(screen.getByRole('button', { name: 'Envoyer un test sur Slack' })).toBeDisabled();
    cleanup();

    actions.sendTemplateTestMessage.mockResolvedValue({
      ok: false,
      code: 'rateLimited',
      retryAfterSeconds: 7,
    });
    renderEditor(dataWith({ discord: scope({}) }), { initialScope: 'discord' });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer un test sur Discord' }));
    expect(
      await screen.findByText('Un test vient de partir. Réessayer dans 7 s.'),
    ).toBeInTheDocument();
  });

  it('asks before the mentions are live', async () => {
    renderEditor(dataWith({ discord: scope({ above: '{@here}' }) }), { initialScope: 'discord' });
    fireEvent.click(screen.getByRole('switch', { name: /Prévenir vraiment/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Mentionner vraiment les personnes ?')).toBeInTheDocument();
  });
});

describe('what the page tells about the template', () => {
  it('warns that the platform’s own message was sent when the template could not be used', () => {
    renderEditor(
      dataWith({
        all: {
          ...scope({ title: 'x' }),
          fallback: { at: '2026-10-21T09:00:00.000Z', reason: 'invalid' },
        },
      }),
    );
    expect(
      screen.getByText('Le message de la plateforme a été envoyé à la place'),
    ).toBeInTheDocument();
    expect(screen.getByText(/il contenait une erreur/)).toBeInTheDocument();
  });

  it('is in English too', () => {
    renderEditor(dataWith(), { locale: 'en' });
    expect(screen.getByRole('tab', { name: 'All channels' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('{title}');
  });
});

describe('more of the editor', () => {
  const open = (name: RegExp | string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
    return screen.findByRole('menuitem', { name });
  };

  it('has the fields of an e-mail, and stores what is typed in them', async () => {
    renderEditor(dataWith({ email: scope({}) }), { initialScope: 'email' });
    fireEvent.change(screen.getByLabelText("Objet de l'e-mail"), {
      target: { value: 'Salut {titre}' },
    });
    fireEvent.change(screen.getByLabelText("Ligne d'aperçu dans la boîte de réception"), {
      target: { value: 'Un aperçu' },
    });
    fireEvent.change(screen.getByLabelText('Note en bas du message'), {
      target: { value: 'Une note' },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveTemplate).toHaveBeenCalled());
    expect(actions.saveTemplate.mock.calls[0]![0]).toMatchObject({
      scope: 'email',
      content: { subject: 'Salut {title}', preheader: 'Un aperçu', note: 'Une note' },
    });
  });

  it('has no message above the card for an e-mail, and no emoji outside Discord', () => {
    renderEditor(dataWith({ email: scope({}) }), { initialScope: 'email' });
    expect(screen.queryByLabelText('Texte au-dessus de la carte')).toBeNull();
    expect(screen.queryByLabelText('Emoji du titre')).toBeNull();
  });

  it('edits the e-mail of an approved member by itself: it follows nothing', () => {
    const data = dataWith();
    data.type = 'memberApproved';
    data.shared = ['discord', 'slack'];
    renderEditor(data, { initialScope: 'email' });
    expect(screen.queryByText(/suit le modèle commun/)).toBeNull();
    expect(screen.getByLabelText('Titre')).toBeInTheDocument();
    expect(screen.getByText(/Ce canal a son propre message/)).toBeInTheDocument();
  });

  it('has the emoji of the title on Discord, and stores a change', async () => {
    renderEditor(dataWith({ discord: scope({}) }), { initialScope: 'discord' });
    expect(screen.getByLabelText('Emoji du titre')).toHaveValue('🎉');
    fireEvent.change(screen.getByLabelText('Emoji du titre'), { target: { value: '🥳' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveTemplate).toHaveBeenCalled());
    expect(actions.saveTemplate.mock.calls[0]![0].content).toEqual({ emoji: '🥳' });
  });

  it('chooses a colour, and goes back to automatic', async () => {
    renderEditor();
    const automatic = await screen.findByRole('switch', { name: 'Couleur de la barre' });
    expect(screen.queryByLabelText('Choisir la couleur')).toBeNull();
    fireEvent.click(automatic);
    const picker = await screen.findByLabelText('Choisir la couleur');
    expect(picker).toHaveValue('#2f5bea');
    fireEvent.change(picker, { target: { value: '#112233' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveTemplate).toHaveBeenCalled());
    expect(actions.saveTemplate.mock.calls[0]![0].content).toEqual({ color: '#112233' });
    fireEvent.click(await screen.findByRole('switch', { name: 'Couleur de la barre' }));
    expect(screen.queryByLabelText('Choisir la couleur')).toBeNull();
  });

  it('turns the button off, or gives it words and an address of its own', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Texte du bouton'), { target: { value: 'Y aller' } });
    fireEvent.change(screen.getByLabelText('Adresse du bouton'), {
      target: { value: 'https://forms.example.fr/x' },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.saveTemplate).toHaveBeenCalled());
    expect(actions.saveTemplate.mock.calls[0]![0].content).toEqual({
      button: { label: 'Y aller', url: 'https://forms.example.fr/x' },
    });
    fireEvent.click(await screen.findByRole('switch', { name: 'Montrer un bouton' }));
    expect(screen.queryByLabelText('Texte du bouton')).toBeNull();
  });

  it('shows a mention in the picture by the name of the directory', async () => {
    const data = dataWith({ discord: scope({ above: '{@role:bureau}' }) });
    data.mentions = [
      {
        id: 'm1',
        key: 'bureau',
        platform: 'discord',
        kind: 'role',
        label: 'Le Bureau',
        externalId: '123',
      },
    ];
    actions.previewTemplate.mockResolvedValue({
      ok: true,
      preview: {
        channel: 'discord',
        above: { text: '<@&123>', mentions: { everyone: false, roles: ['123'], users: [] } },
        embed: { title: 'T' },
      },
    });
    renderEditor(data, { initialScope: 'discord' });
    expect(await screen.findByText('@Le Bureau')).toBeInTheDocument();
  });

  it('inserts a mention in the message above the card', async () => {
    renderEditor(dataWith({ discord: scope({ above: 'Salut ' }) }), { initialScope: 'discord' });
    const above = screen.getByLabelText('Texte au-dessus de la carte') as HTMLTextAreaElement;
    above.setSelectionRange(6, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Mentionner' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /@here/ }));
    await waitFor(() => expect(above).toHaveValue('Salut {@here}'));
  });

  it('chooses which channel to preview for all of them', async () => {
    renderEditor();
    await waitFor(() => expect(actions.previewTemplate).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'E-mail' }));
    await waitFor(() =>
      expect(actions.previewTemplate).toHaveBeenLastCalledWith(
        expect.objectContaining({ channel: 'email' }),
      ),
    );
    expect(screen.getByRole('button', { name: 'E-mail' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the preview or the fields on a small screen, one at a time', () => {
    renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name: 'Aperçu' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Aperçu' })[0]).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(screen.getByRole('button', { name: 'Modifier' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('forgets what was typed on the tab when asked to', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Autre' } });
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler les modifications' }));
    expect(screen.getByLabelText('Titre')).toHaveValue('{titre}');
  });

  it('marks the tab that has unsaved changes, and asks the browser before leaving', () => {
    const add = vi.spyOn(window, 'addEventListener');
    renderEditor();
    expect(add.mock.calls.some(([name]) => name === 'beforeunload')).toBe(false);
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Autre' } });
    expect(add.mock.calls.some(([name]) => name === 'beforeunload')).toBe(true);
    expect(
      screen.getByLabelText('Modifications non enregistrées', { selector: 'span' }),
    ).toBeInTheDocument();
    add.mockRestore();
  });

  it('puts a tab back as the platform writes it, after asking', async () => {
    actions.resetTemplate.mockResolvedValue({ ok: false, code: 'notFound' });
    renderEditor(dataWith({ all: scope({ title: 'x' }) }));
    fireEvent.click(await open(/Revenir au message de la plateforme/));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revenir au défaut' }));
    await waitFor(() =>
      expect(actions.resetTemplate).toHaveBeenCalledWith({ type: 'eventConfirmed', scope: 'all' }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('puts everything back, after asking', async () => {
    actions.resetNotification.mockResolvedValue({ ok: false, code: 'notFound' });
    renderEditor(dataWith({ slack: scope({ title: 'x' }) }));
    fireEvent.click(await open(/Tout remettre comme la plateforme/));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revenir au défaut' }));
    await waitFor(() =>
      expect(actions.resetNotification).toHaveBeenCalledWith({ type: 'eventConfirmed' }),
    );
  });

  it('has nothing to put back for a notification nobody customised', async () => {
    renderEditor();
    expect(await open(/Revenir au message de la plateforme/)).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: /Tout remettre/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('opens the history of the tab', async () => {
    actions.loadHistory.mockResolvedValue({ entries: [] });
    renderEditor();
    fireEvent.click(await open('Historique des versions'));
    expect(await screen.findByText('Historique : Tous les canaux')).toBeInTheDocument();
    expect(actions.loadHistory).toHaveBeenCalledWith({ type: 'eventConfirmed', scope: 'all' });
  });

  it('says the platform improved a message, and marks it as seen after asking', async () => {
    actions.acknowledgeRevision.mockResolvedValue({ ok: false, code: 'notFound' });
    renderEditor(
      dataWith({ all: { ...scope({ title: 'x' }), outdated: ['newFooter', 'plain words'] } }),
    );
    expect(screen.getByText('La plateforme a amélioré ce message')).toBeInTheDocument();
    expect(screen.getByText('plain words')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "C'est noté" }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: "C'est noté" }));
    await waitFor(() =>
      expect(actions.acknowledgeRevision).toHaveBeenCalledWith({
        type: 'eventConfirmed',
        scope: 'all',
      }),
    );
  });

  it('says what happened after an action that loaded the page again', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <TemplateEditor
          data={dataWith()}
          initialScope="all"
          notice="restored"
          testable={{ discord: true, slack: false, email: true }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Version restaurée.')).toBeInTheDocument();
  });

  it('says why a template was not used, even for a reason it does not know', () => {
    renderEditor(
      dataWith({
        all: { ...scope({}), fallback: { at: '2026-10-21T09:00:00.000Z', reason: 'weird' } },
      }),
    );
    expect(screen.getByText(/raison inconnue/)).toBeInTheDocument();
  });

  it('warns that unsaved changes would be lost when customising a channel', async () => {
    renderEditor(dataWith(), { initialScope: 'all' });
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Autre' } });
    fireEvent.click(screen.getByRole('tab', { name: /Slack/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Personnaliser ce canal' }));
    expect(await screen.findByText(/seront perdues/)).toBeInTheDocument();
  });

  it('says it could not draw the preview', async () => {
    actions.previewTemplate.mockRejectedValue(new Error('down'));
    renderEditor();
    expect(await screen.findByText(/n'a pas pu être préparé/)).toBeInTheDocument();
  });

  it('says a save was refused for a reason it can say, or a toast for any other', async () => {
    actions.saveTemplate.mockResolvedValue({ ok: false, code: 'channelNotForType' });
    renderEditor();
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Autre' } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Cette notification n'est pas envoyée sur ce canal.",
      ),
    );
    actions.saveTemplate.mockResolvedValue({ ok: true, version: 1, changed: false });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Rien à enregistrer : le modèle est déjà celui-ci',
      ),
    );
  });

  it('says why a test failed, or could not start', async () => {
    renderEditor(dataWith({ discord: scope({}) }), { initialScope: 'discord' });
    const send = async () =>
      fireEvent.click(await screen.findByRole('button', { name: 'Envoyer un test sur Discord' }));
    actions.sendTemplateTestMessage.mockResolvedValue({
      ok: false,
      code: 'failed',
      detail: 'Discord a répondu 500',
    });
    await send();
    expect(
      await screen.findByText(/Le test n'a pas pu être envoyé : Discord a répondu 500/),
    ).toBeInTheDocument();
    actions.sendTemplateTestMessage.mockResolvedValue({ ok: false, code: 'invalid' });
    await send();
    expect(await screen.findByText(/corriger avant de tester/)).toBeInTheDocument();
    actions.sendTemplateTestMessage.mockResolvedValue({ ok: false, code: 'notConfigured' });
    await send();
    expect(await screen.findAllByText(/Discord n'est pas configuré/)).not.toHaveLength(0);
  });

  it('sends a test with the mentions live only after the person confirmed', async () => {
    actions.sendTemplateTestMessage.mockResolvedValue({ ok: true });
    renderEditor(dataWith({ discord: scope({ above: '{@here}' }) }), { initialScope: 'discord' });
    fireEvent.click(screen.getByRole('switch', { name: /Prévenir vraiment/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Activer les mentions' }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Prévenir vraiment/ })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer un test sur Discord' }));
    await waitFor(() =>
      expect(actions.sendTemplateTestMessage.mock.calls[0]![0]).toMatchObject({
        withMentions: true,
      }),
    );
    // and can be turned off again with no question
    fireEvent.click(screen.getByRole('switch', { name: /Prévenir vraiment/ }));
    expect(screen.getByRole('switch', { name: /Prévenir vraiment/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('says a notification is not sent on a channel yet', () => {
    renderEditor(dataWith({ slack: scope({}) }), { initialScope: 'slack' });
    expect(screen.getByText(/pas envoyée sur Slack/)).toBeInTheDocument();
  });
});
