import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';

vi.mock('@/app/[locale]/(app)/profile/actions', () => ({ saveMentionIds: vi.fn() }));

const { MentionIdsWindow } = await import('./mention-ids-window');

afterEach(cleanup);

const renderWindow = (props: Partial<Parameters<typeof MentionIdsWindow>[0]> = {}) => {
  const signOut = vi.fn(async () => undefined);
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <MentionIdsWindow
        missing={['slack']}
        required={['discord', 'slack']}
        initial={{ discordUserId: '348291047563210241', slackUserId: '' }}
        signOutAction={signOut}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { signOut };
};

describe('the window that asks a missing id', () => {
  it('is an alert dialog, named by what is missing and described by why', async () => {
    renderWindow();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Il manque votre identifiant Slack');
    expect(dialog).toHaveAccessibleDescription(/vous mentionner dans ses notifications/);
  });

  it('asks only for what is missing, and says so for several platforms', async () => {
    renderWindow();
    await screen.findByRole('alertdialog');
    expect(screen.getByLabelText('Votre identifiant Slack')).toBeRequired();
    expect(screen.queryByLabelText('Votre identifiant Discord')).toBeNull();
    cleanup();
    renderWindow({
      missing: ['discord', 'slack'],
      initial: { discordUserId: '', slackUserId: '' },
    });
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleName(
      'Il manque vos identifiants Discord et Slack',
    );
    expect(screen.getByLabelText('Votre identifiant Discord')).toBeInTheDocument();
    expect(screen.getByLabelText('Votre identifiant Slack')).toBeInTheDocument();
  });

  it('cannot be closed: not by Escape, not by a click outside, and it has no close button', async () => {
    renderWindow();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fermer|close/i })).toBeNull();
  });

  it('puts the focus on the first field to give', async () => {
    renderWindow();
    await screen.findByRole('alertdialog');
    await waitFor(() => expect(screen.getByLabelText('Votre identifiant Slack')).toHaveFocus());
  });

  it('has one way out other than giving the id: "Se déconnecter"', async () => {
    const { signOut } = renderWindow();
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });
});
