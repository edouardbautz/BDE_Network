import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MentionIdsState } from '@/app/[locale]/(app)/profile/actions';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
const save = vi.fn<(previous: MentionIdsState, formData: FormData) => Promise<MentionIdsState>>();
vi.mock('@/app/[locale]/(app)/profile/actions', () => ({
  saveMentionIds: (previous: MentionIdsState, formData: FormData) => save(previous, formData),
}));

const { ProfileMentionIds } = await import('./mention-ids');

beforeEach(() => save.mockReset());
afterEach(cleanup);

describe('ProfileMentionIds', () => {
  it('shows the ids already saved, and explains where to find them', () => {
    render(<ProfileMentionIds discordUserId="348291047563210241" slackUserId="U04ABCD1234" />);
    expect(screen.getByLabelText('discord')).toHaveValue('348291047563210241');
    expect(screen.getByLabelText('slack')).toHaveValue('U04ABCD1234');
    expect(screen.getByLabelText('discord')).toHaveAccessibleDescription('discordHelp');
  });

  it('sends what is typed and says it is saved', async () => {
    save.mockResolvedValue({
      saved: true,
      values: { discordUserId: '348291047563210241', slackUserId: '' },
    });
    render(<ProfileMentionIds discordUserId="" slackUserId="" />);
    fireEvent.change(screen.getByLabelText('discord'), {
      target: { value: '<@348291047563210241>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved'));
    const sent = save.mock.calls[0]?.[1] as FormData;
    expect(sent.get('discordUserId')).toBe('<@348291047563210241>');
    expect(sent.get('slackUserId')).toBe('');
  });

  it('puts the message of a refused id on its field, and keeps what was typed', async () => {
    save.mockResolvedValue({
      errors: { discordUserId: 'invalid' },
      values: { discordUserId: '@everyone', slackUserId: '' },
    });
    render(<ProfileMentionIds discordUserId="" slackUserId="" />);
    fireEvent.change(screen.getByLabelText('discord'), { target: { value: '@everyone' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(screen.getByLabelText('discord')).toHaveAccessibleDescription('invalid'),
    );
    expect(screen.getByLabelText('discord')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('discord')).toHaveValue('@everyone');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
