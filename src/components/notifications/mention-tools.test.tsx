import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MentionView } from '@/lib/notifications/templates/editor-data';
import fr from '../../../messages/fr.json';

const actions = vi.hoisted(() => ({ addMention: vi.fn(), removeMention: vi.fn() }));
vi.mock('@/app/[locale]/(app)/notifications/actions', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MentionTools } = await import('./mention-tools');

afterEach(cleanup);
beforeEach(() => {
  actions.addMention.mockReset();
  actions.removeMention.mockReset();
});

const BUREAU: MentionView = {
  id: 'm1',
  key: 'bureau',
  platform: 'discord',
  kind: 'role',
  label: 'Le Bureau',
  externalId: '123456789012345678',
};
const PAULA: MentionView = {
  id: 'm2',
  key: 'paula',
  platform: 'slack',
  kind: 'user',
  label: 'Paula',
  externalId: 'U01ABCDE2F3',
};

function Harness({
  scope,
  initial = [BUREAU, PAULA],
  onInsert = () => {},
}: {
  scope: 'all' | 'discord' | 'slack';
  initial?: MentionView[];
  onInsert?: (token: string) => void;
}) {
  const [mentions, setMentions] = useState(initial);
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <MentionTools
        scope={scope}
        mentions={mentions}
        onMentionsChange={setMentions}
        onInsert={onInsert}
      />
    </NextIntlClientProvider>
  );
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Mentionner' }));

describe('what a message can mention', () => {
  it('offers everybody and the people of the channel, and writes the name, not the identifier', async () => {
    const onInsert = vi.fn();
    render(<Harness scope="discord" onInsert={onInsert} />);
    open();
    expect(await screen.findByRole('menuitem', { name: /@everyone/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /@here/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /@channel/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Paula/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Le Bureau/ }));
    expect(onInsert).toHaveBeenCalledWith('{@role:bureau}');
  });

  it('offers @channel and the people of Slack on a Slack tab', async () => {
    const onInsert = vi.fn();
    render(<Harness scope="slack" onInsert={onInsert} />);
    open();
    expect(await screen.findByRole('menuitem', { name: /@channel/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Le Bureau/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Paula/ }));
    expect(onInsert).toHaveBeenCalledWith('{@user:paula}');
  });

  it('offers only everybody for all channels: the people belong to one platform', async () => {
    const onInsert = vi.fn();
    render(<Harness scope="all" onInsert={onInsert} />);
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: /@here/ }));
    expect(onInsert).toHaveBeenCalledWith('{@here}');
    open();
    await screen.findByRole('menuitem', { name: /@everyone/ });
    expect(screen.queryByRole('menuitem', { name: /Gérer/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Le Bureau/ })).toBeNull();
  });
});

describe('the directory of a platform', () => {
  const openDirectory = async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Gérer les personnes/ }));
    return screen.findByRole('dialog');
  };

  it('lists who is there, for this platform only', async () => {
    render(<Harness scope="discord" />);
    const dialog = await openDirectory();
    expect(within(dialog).getByText('Le Bureau')).toBeInTheDocument();
    expect(within(dialog).queryByText('Paula')).toBeNull();
    expect(dialog).toHaveTextContent('Discord');
  });

  it('says so when nobody is there yet', async () => {
    render(<Harness scope="slack" initial={[]} />);
    const dialog = await openDirectory();
    expect(dialog).toHaveTextContent('Personne pour le moment.');
  });

  it('adds somebody under a name made from the label, and clears the form', async () => {
    actions.addMention.mockResolvedValue({ ok: true, id: 'm9' });
    render(<Harness scope="discord" initial={[]} />);
    const dialog = await openDirectory();
    const add = within(dialog).getByRole('button', { name: 'Ajouter' });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Nom affiché'), {
      target: { value: 'Équipe Événements' },
    });
    fireEvent.change(within(dialog).getByLabelText('Identifiant'), {
      target: { value: '123456789012345678' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Personne' }));
    fireEvent.click(add);
    await waitFor(() =>
      expect(actions.addMention).toHaveBeenCalledWith({
        platform: 'discord',
        kind: 'user',
        key: 'equipe-evenements',
        label: 'Équipe Événements',
        externalId: '123456789012345678',
      }),
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Retirer Équipe Événements' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nom affiché')).toHaveValue('');
  });

  it('says why somebody was refused', async () => {
    actions.addMention.mockResolvedValue({ ok: false, code: 'mentionExists' });
    render(<Harness scope="discord" initial={[]} />);
    const dialog = await openDirectory();
    fireEvent.change(within(dialog).getByLabelText('Nom affiché'), { target: { value: 'Bureau' } });
    fireEvent.change(within(dialog).getByLabelText('Identifiant'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Un nom identique existe déjà.',
    );
  });

  it('says what is wrong with the identifier, in the field’s own words', async () => {
    actions.addMention.mockResolvedValue({
      ok: false,
      code: 'invalid',
      issues: [{ path: 'externalId', code: 'badMentionId' }],
    });
    render(<Harness scope="discord" initial={[]} />);
    const dialog = await openDirectory();
    fireEvent.change(within(dialog).getByLabelText('Nom affiché'), { target: { value: 'Nobody' } });
    fireEvent.change(within(dialog).getByLabelText('Identifiant'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "L'identifiant n'a pas la forme attendue.",
    );
  });

  it('takes somebody off, unless a template still mentions them', async () => {
    actions.removeMention.mockResolvedValueOnce({
      ok: false,
      code: 'mentionInUse',
      detail: 'memberPending:discord',
    });
    render(<Harness scope="discord" />);
    const dialog = await openDirectory();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer Le Bureau' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('memberPending:discord');
    expect(within(dialog).getByText('Le Bureau')).toBeInTheDocument();

    actions.removeMention.mockResolvedValueOnce({ ok: true });
    // the first removal is over once its button works again
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Retirer Le Bureau' })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer Le Bureau' }));
    await waitFor(() => expect(within(dialog).queryByText('Le Bureau')).toBeNull(), {
      timeout: 5000,
    });
    expect(actions.removeMention).toHaveBeenLastCalledWith({ id: 'm1' });
  });

  it('says something went wrong for a refusal it has no sentence for', async () => {
    actions.removeMention.mockResolvedValue({ ok: false, code: 'whatever' });
    render(<Harness scope="discord" />);
    const dialog = await openDirectory();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer Le Bureau' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Une erreur est survenue');
  });

  it('closes', async () => {
    render(<Harness scope="discord" />);
    const dialog = await openDirectory();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Fermer' })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
