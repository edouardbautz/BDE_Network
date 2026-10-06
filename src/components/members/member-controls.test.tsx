import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    namespace === 'confirmDialog'
      ? `confirmDialog.${key}`
      : values
        ? `${key}${JSON.stringify(values)}`
        : key,
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/members/actions', () => ({
  approveMember: vi.fn(),
  changeMemberRole: vi.fn(),
  rejectMember: vi.fn(),
  removeMember: vi.fn(),
}));

const { toast } = await import('sonner');
const actions = await import('@/app/[locale]/(app)/members/actions');
const { MemberRoleSelect, PendingMemberActions, RemoveMemberButton } =
  await import('./member-controls');

const roles = [
  { id: 'role-member', name: 'Membre', grantable: true },
  { id: 'role-secretary', name: 'Secrétaire', grantable: true },
  { id: 'role-admin', name: 'Admin', grantable: false },
];

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/** Every destructive or irreversible action asks in a dialog; these helpers drive it. */
const dialog = () => screen.findByRole('dialog');
const confirmButton = (label: string) => screen.getByRole('button', { name: label });
const cancelButton = () => screen.getByRole('button', { name: 'confirmDialog.cancel' });

describe('MemberRoleSelect', () => {
  const renderSelect = (lock: 'self' | 'above' | null = null) =>
    render(
      <MemberRoleSelect
        userId="u1"
        memberName="Alice"
        currentRoleId="role-member"
        roles={roles}
        lock={lock}
      />,
    );
  // The page behind an open dialog is hidden from assistive technology, hence { hidden: true }.
  const select = () => screen.getByRole('combobox', { hidden: true }) as HTMLSelectElement;

  it('asks before changing a role, and says from which role to which', async () => {
    renderSelect();

    fireEvent.change(select(), { target: { value: 'role-secretary' } });

    await dialog();
    expect(screen.getByText('roleChangeTitle{"name":"Alice"}')).toBeTruthy();
    expect(
      screen.getByText('roleChangeBody{"name":"Alice","from":"Membre","to":"Secrétaire"}'),
    ).toBeTruthy();
    expect(actions.changeMemberRole).not.toHaveBeenCalled();
    expect(select().value).toBe('role-member'); // nothing changed yet
  });

  it('gives the new role once confirmed', async () => {
    vi.mocked(actions.changeMemberRole).mockResolvedValue({ ok: true });
    renderSelect();

    fireEvent.change(select(), { target: { value: 'role-secretary' } });
    await dialog();
    fireEvent.click(confirmButton('roleChangeConfirm'));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(actions.changeMemberRole).toHaveBeenCalledExactlyOnceWith('u1', 'role-secretary');
    expect(select().value).toBe('role-secretary');
  });

  it('changes nothing when the dialog is cancelled, and the menu keeps the current role', async () => {
    renderSelect();

    fireEvent.change(select(), { target: { value: 'role-secretary' } });
    await dialog();
    fireEvent.click(cancelButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(actions.changeMemberRole).not.toHaveBeenCalled();
    expect(select().value).toBe('role-member');
  });

  it('keeps the previous role and explains when the server refuses', async () => {
    vi.mocked(actions.changeMemberRole).mockResolvedValue({ ok: false, error: 'cannotGrant' });
    renderSelect();

    fireEvent.change(select(), { target: { value: 'role-secretary' } });
    await dialog();
    fireEvent.click(confirmButton('roleChangeConfirm'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.cannotGrant'));
    expect(refresh).toHaveBeenCalled(); // the list is redrawn: the page may have been out of date
    expect(select().value).toBe('role-member');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('greys out the roles that cannot be given, but keeps the current one selectable', () => {
    renderSelect();

    expect((screen.getByRole('option', { name: 'Admin' }) as HTMLOptionElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('option', { name: 'Membre' }) as HTMLOptionElement).disabled).toBe(
      false,
    );
  });

  it.each(['self', 'above'] as const)('is disabled and says why when locked (%s)', (lock) => {
    renderSelect(lock);

    expect(select().disabled).toBe(true);
    expect(screen.getByText(`locked.${lock}`)).toBeTruthy();
  });
});

describe('PendingMemberActions', () => {
  const renderPending = (initialRoleId = 'role-member') =>
    render(
      <PendingMemberActions
        userId="u2"
        memberName="Bob"
        roles={roles}
        initialRoleId={initialRoleId}
      />,
    );

  it('approves with the role picked next to the button', async () => {
    vi.mocked(actions.approveMember).mockResolvedValue({ ok: true });
    renderPending();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'role-secretary' } });
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));

    await waitFor(() => expect(actions.approveMember).toHaveBeenCalledWith('u2', 'role-secretary'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('cannot approve with a role the viewer may not give', () => {
    renderPending('role-admin');

    expect((screen.getByRole('button', { name: 'approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the refusal in plain words', async () => {
    vi.mocked(actions.approveMember).mockResolvedValue({ ok: false, error: 'targetNotPending' });
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: 'approve' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.targetNotPending'));
    expect(refresh).toHaveBeenCalled();
  });

  it('asks in a dialog before refusing: opening it refuses nothing', async () => {
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: /^reject/ }));

    await dialog();
    expect(screen.getByText('rejectTitle{"name":"Bob"}')).toBeTruthy();
    expect(screen.getByText('rejectWarning{"name":"Bob"}')).toBeTruthy();
    expect(actions.rejectMember).not.toHaveBeenCalled();
  });

  it('refuses the request once confirmed', async () => {
    vi.mocked(actions.rejectMember).mockResolvedValue({ ok: true });
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: /^reject/ }));
    await dialog();
    fireEvent.click(confirmButton('rejectConfirm'));

    await waitFor(() => expect(actions.rejectMember).toHaveBeenCalledExactlyOnceWith('u2'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('does not refuse when the dialog is cancelled', async () => {
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: /^reject/ }));
    await dialog();
    fireEvent.click(cancelButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(actions.rejectMember).not.toHaveBeenCalled();
  });

  it('says why when the request was already handled by someone else', async () => {
    vi.mocked(actions.rejectMember).mockResolvedValue({ ok: false, error: 'targetNotPending' });
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: /^reject/ }));
    await dialog();
    fireEvent.click(confirmButton('rejectConfirm'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.targetNotPending'));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('RemoveMemberButton', () => {
  const renderRemove = () =>
    render(<RemoveMemberButton userId="u3" login="carol" memberName="Carol" />);
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^remove/ }));
    await dialog();
  };

  it('asks first: nothing is removed by pressing the button', async () => {
    renderRemove();

    await open();

    expect(screen.getByText('removeTitle{"name":"Carol"}')).toBeTruthy();
    expect(screen.getByText('removeWarning{"name":"Carol"}')).toBeTruthy();
    expect(actions.removeMember).not.toHaveBeenCalled();
  });

  it('removes after confirmation and goes back to the list with the login', async () => {
    vi.mocked(actions.removeMember).mockResolvedValue({ ok: true, login: 'carol' });
    renderRemove();

    await open();
    fireEvent.click(confirmButton('removeConfirm'));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ pathname: '/members', query: { removed: 'carol' } }),
    );
    expect(actions.removeMember).toHaveBeenCalledExactlyOnceWith('u3');
  });

  it('removes nobody when the dialog is cancelled', async () => {
    renderRemove();

    await open();
    fireEvent.click(cancelButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(actions.removeMember).not.toHaveBeenCalled();
  });

  it('stays on the page and explains when the server refuses', async () => {
    vi.mocked(actions.removeMember).mockResolvedValue({ ok: false, error: 'cannotManageMember' });
    renderRemove();

    await open();
    fireEvent.click(confirmButton('removeConfirm'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.cannotManageMember'));
    expect(push).not.toHaveBeenCalled();
  });
});
