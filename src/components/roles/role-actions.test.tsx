import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/roles/actions', () => ({
  deleteRole: vi.fn(),
  setDefaultRole: vi.fn(),
}));

const { toast } = await import('sonner');
const actions = await import('@/app/[locale]/(app)/roles/actions');
const { RoleActions } = await import('./role-actions');

const renderActions = (props: Partial<Parameters<typeof RoleActions>[0]> = {}) =>
  render(
    <RoleActions
      roleId="r1"
      roleName="Trésorier"
      isDefault={false}
      memberCount={0}
      manageable
      lockedReason={null}
      {...props}
    />,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('RoleActions', () => {
  it('offers edit, make default and delete on a role the viewer may manage', () => {
    renderActions();

    expect(document.querySelector('a[href="/roles/r1"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /setDefaultLabel/ })).toBeTruthy();
    expect(screen.getByText('list.deleteWarning{"name":"Trésorier"}')).toBeTruthy();
  });

  it('shows only the reason when the role is not theirs to manage', () => {
    renderActions({ manageable: false, lockedReason: 'own' });
    expect(screen.getByText('list.lockedOwn')).toBeTruthy();
    expect(document.querySelector('a')).toBeNull();
    cleanup();

    renderActions({ manageable: false, lockedReason: 'above' });
    expect(screen.getByText('list.lockedAbove')).toBeTruthy();
  });

  it('cannot delete or demote the default role', () => {
    renderActions({ isDefault: true });

    expect(screen.queryByRole('button', { name: /setDefaultLabel/ })).toBeNull();
    expect(screen.queryByText(/list\.deleteWarning/)).toBeNull();
  });

  it('explains instead of offering the deletion when members still have the role', () => {
    renderActions({ memberCount: 3 });

    expect(screen.getByText('list.deleteInUse{"count":3}')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'list.deleteConfirm' })).toBeNull();
  });

  it('deletes after confirmation and says so', async () => {
    vi.mocked(actions.deleteRole).mockResolvedValue({ ok: true });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'list.deleteConfirm' }));

    await waitFor(() => expect(actions.deleteRole).toHaveBeenCalledWith('r1'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('tells the viewer and redraws the list when the role is already gone', async () => {
    vi.mocked(actions.deleteRole).mockResolvedValue({ ok: false, error: 'roleNotFound' });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'list.deleteConfirm' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.roleNotFound'));
    expect(refresh).toHaveBeenCalled();
  });

  it('makes the role the default one', async () => {
    vi.mocked(actions.setDefaultRole).mockResolvedValue({ ok: true });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: /setDefaultLabel/ }));

    await waitFor(() => expect(actions.setDefaultRole).toHaveBeenCalledWith('r1'));
  });
});
