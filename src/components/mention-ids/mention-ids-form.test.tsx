import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MentionIdsState } from '@/app/[locale]/(app)/profile/actions';
import fr from '../../../messages/fr.json';

const save = vi.fn<(previous: MentionIdsState, formData: FormData) => Promise<MentionIdsState>>();
vi.mock('@/app/[locale]/(app)/profile/actions', () => ({
  saveMentionIds: (previous: MentionIdsState, formData: FormData) => save(previous, formData),
}));

const { MentionIdsForm } = await import('./mention-ids-form');

beforeEach(() => save.mockReset());
afterEach(cleanup);

const DISCORD = '348291047563210241';
const empty = { discordUserId: '', slackUserId: '' };

const renderForm = (props: Partial<Parameters<typeof MentionIdsForm>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <MentionIdsForm
        platforms={['discord', 'slack']}
        initial={empty}
        submit="Continuer"
        mode="profile"
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe('the form of the ids', () => {
  it('has one required field per platform that is asked, and none for the others', () => {
    renderForm({ platforms: ['slack'] });
    expect(screen.getByLabelText('Votre identifiant Slack')).toBeRequired();
    expect(screen.queryByLabelText('Votre identifiant Discord')).toBeNull();
    // a guide for the platform asked, open
    expect(screen.getByTestId('guide-slack')).toHaveAttribute('open');
    expect(screen.queryByTestId('guide-discord')).toBeNull();
  });

  it('opens only the guide of the first id still to give: two open guides would push the button far down a phone', () => {
    renderForm();
    expect(screen.getByTestId('guide-discord')).toHaveAttribute('open');
    expect(screen.getByTestId('guide-slack')).not.toHaveAttribute('open');
  });

  it('shows what is already given, with the guide closed once the id is good', () => {
    renderForm({ initial: { discordUserId: DISCORD, slackUserId: '' } });
    expect(screen.getByLabelText('Votre identifiant Discord')).toHaveValue(DISCORD);
    expect(screen.getByText('Identifiant valable')).toBeInTheDocument();
    expect(screen.getByTestId('guide-discord')).not.toHaveAttribute('open');
    expect(screen.getByTestId('guide-slack')).toHaveAttribute('open');
  });

  it('says at once that an id is valid, and says what is wrong with one that is not, once the field is left', () => {
    renderForm();
    const field = screen.getByLabelText('Votre identifiant Slack');
    fireEvent.change(field, { target: { value: '@camille' } });
    // not told while typing…
    expect(field).not.toHaveAttribute('aria-invalid');
    fireEvent.blur(field);
    // …told when the field is left
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('collez l’ID du membre');
    expect(field).toHaveAccessibleDescription(/collez l’ID du membre/);
    fireEvent.change(field, { target: { value: 'u04abcd1234' } });
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('Identifiant valable')).toBeInTheDocument();
  });

  it.each(['@everyone', '@here', '<@&123456789012345678>', 'camille', '<!channel>'])(
    'does not take %s for an id',
    (typed) => {
      renderForm();
      const field = screen.getByLabelText('Votre identifiant Discord');
      fireEvent.change(field, { target: { value: typed } });
      fireEvent.blur(field);
      expect(field).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('sends what is typed, and says it is saved on the profile', async () => {
    save.mockResolvedValue({ saved: true, values: { discordUserId: DISCORD, slackUserId: '' } });
    renderForm({ platforms: ['discord'] });
    fireEvent.change(screen.getByLabelText('Votre identifiant Discord'), {
      target: { value: `<@${DISCORD}>` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enregistré.'));
    expect((save.mock.calls[0]?.[1] as FormData).get('discordUserId')).toBe(`<@${DISCORD}>`);
  });

  it('puts the answer of the server on the field: refused, or required', async () => {
    save.mockResolvedValue({
      errors: { discordUserId: 'required' },
      values: { discordUserId: '', slackUserId: '' },
    });
    renderForm({ platforms: ['discord'] });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Cet identifiant est obligatoire'),
    );
    expect(screen.getByLabelText('Votre identifiant Discord')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('loads the page again after a save in the step and the window (what they hid is then there), not on the profile', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    save.mockResolvedValue({ saved: true, values: { discordUserId: DISCORD, slackUserId: '' } });
    renderForm({ platforms: ['discord'], mode: 'step' });
    fireEvent.change(screen.getByLabelText('Votre identifiant Discord'), {
      target: { value: DISCORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    vi.unstubAllGlobals();
  });
});
