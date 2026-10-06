import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, memberWith, sessionFor } from '@/test/session-fixtures';
import { renderToHtml } from '@/test/render-server';

/**
 * What the members panel offers each person looking at it. The menus only mirror the rules of
 * lib/roles/guards.ts (the server enforces them again, see roles/escalation.test.ts): a role
 * the viewer cannot hand out is greyed out, a member above them is locked, an owner has no
 * menu at all, nobody gets a remove button on their own row.
 */

vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () =>
    Object.assign(
      (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
      { has: () => true },
    ),
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ modules: { enabled: ['events'] } })) }));
vi.mock('@/lib/events/export', () => ({ getBdeFeedToken: vi.fn(async () => null) }));
vi.mock('../events/shared-calendar/actions', () => ({ regenerateSharedCalendar: vi.fn() }));
vi.mock('./actions', () => ({
  approveMember: vi.fn(),
  changeMemberRole: vi.fn(),
  rejectMember: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findMany: vi.fn() }, role: { findMany: vi.fn() } },
}));

const { getEffectiveSession } = await import('@/lib/auth/session');
const { prisma } = await import('@/lib/prisma');
const { default: MembersPage } = await import('./page');

const roles = [
  {
    id: 'role-member',
    name: 'Membre',
    description: null,
    permissions: ['events.view'],
    allPermissions: false,
    isDefault: true,
  },
  {
    id: 'role-secretary',
    name: 'Secrétaire',
    description: null,
    permissions: ['events.manage', 'members.manage'],
    allPermissions: false,
    isDefault: false,
  },
  {
    id: 'role-treasurer',
    name: 'Trésorier',
    description: null,
    permissions: ['roles.manage'],
    allPermissions: false,
    isDefault: false,
  },
  {
    id: 'role-admin',
    name: 'Admin',
    description: null,
    permissions: [],
    allPermissions: true,
    isDefault: false,
  },
];

function user(
  id: string,
  status: 'OWNER' | 'MEMBER' | 'PENDING',
  roleId: string | null,
  extra: Record<string, unknown> = {},
) {
  const role = roles.find((candidate) => candidate.id === roleId);
  return {
    id,
    login: id,
    fullName: `Name of ${id}`,
    campus: 'Paris',
    photoUrl: null,
    status,
    roleId,
    role: role ? { id: role.id, name: role.name } : null,
    createdAt: new Date(0),
    ...extra,
  };
}

const people = [
  user('the-owner', 'OWNER', null),
  user('admin-1', 'MEMBER', 'role-admin'),
  user('sec-1', 'MEMBER', 'role-secretary'),
  user('mem-1', 'MEMBER', 'role-member'),
  user('new-1', 'PENDING', null),
];

/** The members page as a DOM, for one viewer. */
async function renderAs(session: ReturnType<typeof memberWith>): Promise<HTMLElement> {
  vi.mocked(getEffectiveSession).mockResolvedValue(effective(session));
  vi.mocked(prisma.user.findMany).mockResolvedValue(people as never);
  vi.mocked(prisma.role.findMany).mockResolvedValue(roles as never);
  const html = await renderToHtml(
    <>
      {await MembersPage({
        params: Promise.resolve({ locale: 'fr' }),
        searchParams: Promise.resolve({}),
      })}
    </>,
  );
  const page = document.createElement('div');
  page.innerHTML = html;
  return page;
}

function rowOf(page: HTMLElement, login: string): HTMLTableRowElement {
  const row = [...page.querySelectorAll('tr')].find((candidate) =>
    candidate.textContent?.includes(`Name of ${login}`),
  );
  if (!row) throw new Error(`no row for ${login}`);
  return row;
}

const menuOf = (row: HTMLElement) => row.querySelector('select');
const optionOf = (row: HTMLElement, roleId: string) =>
  row.querySelector<HTMLOptionElement>(`option[value="${roleId}"]`);

beforeEach(() => vi.clearAllMocks());

describe('members panel — what each viewer is offered', () => {
  // A secretary: manages members and events, holds neither roles.manage nor "all".
  const secretary = () => memberWith(['members.manage', 'events.manage'], 'sec-1', 'sec-1');

  it('greys out the roles the viewer does not fully hold, in every menu', async () => {
    const page = await renderAs(secretary());

    for (const login of ['mem-1', 'new-1']) {
      const row = rowOf(page, login);
      // Membre (events.view) is covered by events.manage; Trésorier and Admin are not.
      expect(optionOf(row, 'role-member')?.disabled).toBe(false);
      expect(optionOf(row, 'role-treasurer')?.disabled).toBe(true);
      expect(optionOf(row, 'role-admin')?.disabled).toBe(true);
    }
  });

  it('locks a member whose role is above the viewer, and offers no removal for them', async () => {
    const row = rowOf(await renderAs(secretary()), 'admin-1');

    expect(menuOf(row)?.disabled).toBe(true);
    expect(row.textContent).toContain('locked.above');
    expect(row.textContent).not.toContain('remove');
  });

  it('locks the viewer’s own row', async () => {
    const row = rowOf(await renderAs(secretary()), 'sec-1');

    expect(menuOf(row)?.disabled).toBe(true);
    expect(row.textContent).toContain('locked.self');
    expect(row.textContent).not.toContain('remove');
  });

  it('lets the viewer change and remove a member whose role they cover', async () => {
    const row = rowOf(await renderAs(secretary()), 'mem-1');

    expect(menuOf(row)?.disabled).toBe(false);
    expect(row.textContent).toContain('remove');
  });

  it('shows an owner as a fixed badge: no menu, no removal', async () => {
    const row = rowOf(await renderAs(secretary()), 'the-owner');

    expect(menuOf(row)).toBeNull();
    expect(row.textContent).toContain('OWNER');
    expect(row.textContent).toContain('ownerNote');
    expect(row.textContent).not.toContain('remove');
  });

  it('keeps Admin ("all rights") out of reach of anyone who does not hold all of them', async () => {
    const page = await renderAs(
      memberWith(['members.manage', 'roles.manage', 'events.manage', 'events.shared_calendar']),
    );

    expect(optionOf(rowOf(page, 'mem-1'), 'role-admin')?.disabled).toBe(true);
    expect(optionOf(rowOf(page, 'mem-1'), 'role-treasurer')?.disabled).toBe(false);
  });

  it('hands out everything to an account that holds every right', async () => {
    const page = await renderAs(sessionFor('ADMIN', 'sec-1', 'sec-1'));

    expect(optionOf(rowOf(page, 'mem-1'), 'role-admin')?.disabled).toBe(false);
    expect(optionOf(rowOf(page, 'mem-1'), 'role-treasurer')?.disabled).toBe(false);
  });

  it('offers the roles page only to a viewer who may manage roles', async () => {
    expect((await renderAs(secretary())).querySelector('a[href="/roles"]')).toBeNull();
    expect(
      (await renderAs(memberWith(['members.manage', 'roles.manage']))).querySelector(
        'a[href="/roles"]',
      ),
    ).not.toBeNull();
  });

  it('proposes the default role first for a request when the viewer may give it, else another they may', async () => {
    expect(menuOf(rowOf(await renderAs(secretary()), 'new-1'))?.value).toBe('role-member');

    // Without events.view the viewer cannot give Membre: the first role they can give is offered.
    const row = rowOf(await renderAs(memberWith(['members.manage', 'roles.manage'])), 'new-1');
    expect(optionOf(row, 'role-member')?.disabled).toBe(true);
    expect(menuOf(row)?.value).toBe('role-treasurer');
  });

  it('cannot approve a request when no role can be given', async () => {
    const row = rowOf(await renderAs(memberWith(['members.manage'])), 'new-1');
    const approve = [...row.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('approve'),
    );

    // members.manage alone covers no role at all (even "Membre" needs events.view).
    expect(approve?.disabled).toBe(true);
  });
});
