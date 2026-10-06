import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleFormState } from '@/app/[locale]/(app)/roles/actions';
import type { RawRoleInput } from '@/lib/roles/input';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { RoleForm } = await import('./role-form');

const groups = [
  {
    section: 'core',
    title: 'Gestion',
    options: [
      {
        key: 'members.manage',
        label: 'Gérer les membres',
        description: 'd1',
        implies: [],
        locked: false,
      },
      {
        key: 'roles.manage',
        label: 'Gérer les rôles',
        description: 'd2',
        implies: [],
        locked: true,
      },
    ],
  },
  {
    section: 'events',
    title: 'Événements',
    options: [
      { key: 'events.view', label: 'Voir', description: 'd3', implies: [], locked: false },
      {
        key: 'events.manage',
        label: 'Gérer',
        description: 'd4',
        implies: ['events.view'],
        locked: false,
      },
    ],
  },
];

const empty: RawRoleInput = { name: '', description: '', allPermissions: false, permissions: [] };
const action = vi.fn(async (): Promise<RoleFormState> => ({}));

function renderForm(initial: RawRoleInput = empty, canGrantAll = true) {
  const view = render(
    <RoleForm
      action={action}
      initial={initial}
      groups={groups}
      canGrantAll={canGrantAll}
      submitLabel="Créer"
      cancelHref="/roles"
    />,
  );
  return { ...view, form: view.container.querySelector('form') as HTMLFormElement };
}

/** The checkbox of one permission. */
const box = (key: string) => document.querySelector<HTMLInputElement>(`input[value="${key}"]`)!;
const allBox = () => document.querySelector<HTMLInputElement>('input[name="allPermissions"]')!;

beforeEach(() => action.mockClear());
afterEach(cleanup);

describe('RoleForm — permission checkboxes', () => {
  it('ticking "manage" also ticks "view"', () => {
    renderForm();
    fireEvent.click(box('events.manage'));

    expect(box('events.manage').checked).toBe(true);
    expect(box('events.view').checked).toBe(true);
  });

  it('unticking "view" also unticks "manage"', () => {
    renderForm({ ...empty, permissions: ['events.view', 'events.manage'] });
    fireEvent.click(box('events.view'));

    expect(box('events.view').checked).toBe(false);
    expect(box('events.manage').checked).toBe(false);
  });

  it('unticking "manage" keeps "view"', () => {
    renderForm({ ...empty, permissions: ['events.view', 'events.manage'] });
    fireEvent.click(box('events.manage'));

    expect(box('events.view').checked).toBe(true);
  });

  it('disables a permission the person cannot give, and says why', () => {
    renderForm();

    expect(box('roles.manage').disabled).toBe(true);
    expect(screen.getByText(/form\.permissionLocked/)).toBeTruthy();
  });

  it('"all permissions" ticks and locks every checkbox', () => {
    renderForm();
    fireEvent.click(allBox());

    expect(box('events.view').checked).toBe(true);
    expect(box('members.manage').checked).toBe(true);
    expect(box('members.manage').disabled).toBe(true);
  });

  it('unticking "all permissions" gives the checkboxes back, so modules can be picked one by one', () => {
    renderForm({ ...empty, allPermissions: true });
    fireEvent.click(allBox());

    expect(box('members.manage').disabled).toBe(false);
    expect(box('members.manage').checked).toBe(false);
  });

  it('does not offer "all permissions" to someone who does not hold them', () => {
    renderForm(empty, false);

    const all = allBox();
    expect(all.disabled).toBe(true);
    expect(screen.getByText('form.allPermissionsLocked')).toBeTruthy();
  });
});

describe('RoleForm — validation before sending', () => {
  it('stops an empty name in the browser, shows the message and focuses the field', () => {
    const { form } = renderForm();

    fireEvent.submit(form);

    expect(action).not.toHaveBeenCalled();

    const name = screen.getByLabelText(/form\.name/);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('form.errors.name.required')).toBeTruthy();
  });

  it('lets a valid form through', () => {
    const { form } = renderForm({ ...empty, name: 'Trésorier' });

    fireEvent.submit(form);

    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('"all rights" explanation (messages)', () => {
  it.each([
    ['fr', fr.roles.form.allPermissionsHelp, ['futurs modules', 'décochez', 'un par un']],
    ['en', en.roles.form.allPermissionsHelp, ['future', 'untick', 'one by one']],
  ])('says in %s that future modules are included and how to reserve one', (_l, text, parts) => {
    for (const part of parts) expect(text).toContain(part);
  });
});
