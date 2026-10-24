import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  test: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { has: () => true }),
  useLocale: () => 'fr',
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('@/app/[locale]/(app)/settings/actions', () => ({
  saveStaffChannel: mocks.save,
  testStaffChannel: mocks.test,
}));

const { StaffChannelSection } = await import('./staff-channel-section');

const none = { hasDiscordWebhook: false, hasSlackWebhook: false };
const DISCORD = 'https://discord.com/api/webhooks/987654321/staff-secret';

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({ ok: true });
  mocks.test.mockReset().mockResolvedValue({ ok: true });
  mocks.toastSuccess.mockReset();
});
afterEach(cleanup);

describe('StaffChannelSection', () => {
  it('says the messages go to the BDE room while nothing is saved, and offers no test yet', () => {
    render(<StaffChannelSection settings={none} />);
    expect(screen.getAllByText('emptyHint')).toHaveLength(2);
    for (const button of screen.getAllByRole('button', { name: 'test' })) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'remove' })).toBeNull();
  });

  it('never shows a saved address: it says there is one, and a test goes to it', async () => {
    render(<StaffChannelSection settings={{ hasDiscordWebhook: true, hasSlackWebhook: false }} />);
    const field = screen.getByLabelText('discord');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('placeholder', 'savedPlaceholder');

    const [discordTest] = screen.getAllByRole('button', { name: 'test' });
    fireEvent.click(discordTest!);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('testSent'));
    expect(mocks.test).toHaveBeenCalledWith({ channel: 'discord', locale: 'fr', webhook: '' });
  });

  it('saves what was typed, forgets the field after, and says it is saved', async () => {
    render(<StaffChannelSection settings={none} />);
    fireEvent.change(screen.getByLabelText('discord'), { target: { value: DISCORD } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('saved'));
    expect(mocks.save).toHaveBeenCalledWith({
      discordWebhook: DISCORD,
      slackWebhook: '',
      removeDiscord: false,
      removeSlack: false,
    });
    expect(screen.getByLabelText('discord')).toHaveValue('');
  });

  it('stages the removal of a saved address until Save, and can take it back', async () => {
    render(<StaffChannelSection settings={{ hasDiscordWebhook: true, hasSlackWebhook: true }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]!);
    expect(screen.getByText('willRemove')).toBeInTheDocument();
    expect(screen.getByLabelText('discord')).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'keep' }));
    expect(screen.queryByText('willRemove')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ removeDiscord: true, removeSlack: false }),
    );
  });

  it('puts the refusal of an address on its field', async () => {
    mocks.save.mockResolvedValue({ ok: false, code: 'discord', field: 'discordWebhook' });
    render(<StaffChannelSection settings={none} />);
    fireEvent.change(screen.getByLabelText('discord'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('discord'));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('says a test failed, with the reason it gives', async () => {
    mocks.test.mockResolvedValue({ ok: false, code: 'testFailed', detail: '404' });
    render(<StaffChannelSection settings={{ hasDiscordWebhook: true, hasSlackWebhook: false }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'test' })[0]!);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('testFailed'));
  });
});
