import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
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
  const select = () => screen.getByRole('combobox') as HTMLSelectElement;

  it('gives the new role and confirms', async () => {
    vi.mocked(actions.changeMemberRole).mockResolvedValue({ ok: true });
    renderSelect();

    fireEvent.change(select(), { target: { value: 'role-secretary' } });

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(actions.changeMemberRole).toHaveBeenCalledWith('u1', 'role-secretary');
    expect(select().value).toBe('role-secretary');
  });

  it('puts the previous role back and explains when the server refuses', async () => {
    vi.mocked(actions.changeMemberRole).mockResolvedValue({ ok: false, error: 'cannotGrant' });
    renderSelect();

    fireEvent.change(select(), { target: { value: 'role-secretary' } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.cannotGrant'));
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
  });

  it('refuses the request', async () => {
    vi.mocked(actions.rejectMember).mockResolvedValue({ ok: true });
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: 'reject' }));

    await waitFor(() => expect(actions.rejectMember).toHaveBeenCalledWith('u2'));
  });
});

describe('RemoveMemberButton', () => {
  const renderRemove = () =>
    render(<RemoveMemberButton userId="u3" login="carol" memberName="Carol" />);

  it('asks first: nothing is removed by opening the control', () => {
    renderRemove();

    expect(actions.removeMember).not.toHaveBeenCalled();
    expect(screen.getByText(/removeWarning/)).toBeTruthy();
  });

  it('removes after confirmation and goes back to the list with the login', async () => {
    vi.mocked(actions.removeMember).mockResolvedValue({ ok: true });
    renderRemove();

    fireEvent.click(screen.getByRole('button', { name: 'removeConfirm' }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ pathname: '/members', query: { removed: 'carol' } }),
    );
    expect(actions.removeMember).toHaveBeenCalledWith('u3');
  });

  it('stays on the page and explains when the server refuses', async () => {
    vi.mocked(actions.removeMember).mockResolvedValue({ ok: false, error: 'cannotManageMember' });
    renderRemove();

    fireEvent.click(screen.getByRole('button', { name: 'removeConfirm' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.cannotManageMember'));
    expect(push).not.toHaveBeenCalled();
  });
});
