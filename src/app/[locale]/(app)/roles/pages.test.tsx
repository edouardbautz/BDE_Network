import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, memberWith, sessionFor, type AccountKind } from '@/test/session-fixtures';
import { renderToHtml } from '@/test/render-server';

/**
 * The roles pages: who is turned away before any role is read, and what each viewer is given —
 * a form for a role they may edit, a read-only summary (no form at all) for their own role or
 * one above them. The server actions enforce the same rules (roles/escalation.test.ts).
 */

const { NotFoundSignal, RedirectSignal } = vi.hoisted(() => ({
  NotFoundSignal: class NotFoundSignal extends Error {},
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
}));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: string }) => {
    throw new RedirectSignal(options.href);
  }),
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'fr'),
  getTranslations: vi.fn(async () =>
    Object.assign(
      (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
      { has: () => false },
    ),
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ modules: { enabled: ['events'] } })) }));
vi.mock('./actions', () => ({
  createRole: vi.fn(),
  updateRole: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }),
  deleteRole: vi.fn(),
  setDefaultRole: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { role: { findMany: vi.fn(), findUnique: vi.fn() } },
}));

const { getEffectiveSession } = await import('@/lib/auth/session');
const { prisma } = await import('@/lib/prisma');
const { default: RolesPage } = await import('./page');
const { default: NewRolePage } = await import('./new/page');
const { default: EditRolePage } = await import('./[id]/page');

const stored = (id: string, name: string, permissions: string[], extra = {}) => ({
  id,
  name,
  description: null,
  permissions,
  allPermissions: false,
  isDefault: false,
  _count: { users: 1 },
  ...extra,
});

const roles = [
  stored('role-member', 'Membre', ['events.view'], { isDefault: true }),
  stored('role-secretary', 'Secrétaire', ['events.manage', 'members.manage']),
  stored('role-treasurer', 'Trésorier', ['roles.manage']),
  stored('role-admin', 'Admin', [], { allPermissions: true }),
];

/** A member holding the stored role `roleId`, with the rights of that role. */
function holding(roleId: string, permissions: string[]) {
  const session = memberWith(permissions, 'tre-1', 'tre-1');
  session.user.roleId = roleId;
  return session;
}

const params = { locale: 'fr' };
const as = (session: ReturnType<typeof sessionFor>) =>
  vi.mocked(getEffectiveSession).mockResolvedValue(effective(session));

async function html(element: Promise<ReactNode>): Promise<string> {
  return renderToHtml(<>{await element}</>);
}

const listPage = () =>
  RolesPage({ params: Promise.resolve(params), searchParams: Promise.resolve({}) });
const newPage = () => NewRolePage({ params: Promise.resolve(params) });
const editPage = (id: string) => EditRolePage({ params: Promise.resolve({ ...params, id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.role.findMany).mockResolvedValue(roles as never);
  vi.mocked(prisma.role.findUnique).mockImplementation(
    (async ({ where }: { where: { id: string } }) =>
      roles.find((role) => role.id === where.id) ?? null) as never,
  );
});

describe('roles pages — direct URL access control', () => {
  const pages = [
    ['the list', () => listPage()],
    ['the creation form', () => newPage()],
    ['the edit page', () => editPage('role-member')],
  ] as const;

  describe.each(pages)('%s', (_name, open) => {
    it.each<AccountKind>(['PENDING', 'MEMBER'])(
      'sends a %s account to the dashboard without reading any role',
      async (kind) => {
        as(sessionFor(kind));

        await expect(open()).rejects.toThrow(RedirectSignal);

        expect(prisma.role.findMany).not.toHaveBeenCalled();
        expect(prisma.role.findUnique).not.toHaveBeenCalled();
      },
    );

    it('turns away a member who manages members but not roles', async () => {
      as(memberWith(['members.manage', 'events.manage']));
      await expect(open()).rejects.toThrow(RedirectSignal);
    });

    it('turns away a visitor with no session', async () => {
      vi.mocked(getEffectiveSession).mockResolvedValue(null);
      await expect(open()).rejects.toThrow(RedirectSignal);
    });

    it.each<AccountKind>(['OWNER', 'ADMIN'])('lets a %s account in', async (kind) => {
      as(sessionFor(kind));
      await expect(open()).resolves.toBeTruthy();
    });

    it('lets in a member whose role has roles.manage', async () => {
      as(memberWith(['roles.manage']));
      await expect(open()).resolves.toBeTruthy();
    });
  });
});

describe('roles list', () => {
  it('shows every role with what the viewer may do on it', async () => {
    as(memberWith(['roles.manage', 'events.view'], 'tre-1', 'tre-1'));
    const page = document.createElement('div');
    page.innerHTML = await html(listPage());
    const row = (name: string) =>
      [...page.querySelectorAll('tr')].find((candidate) => candidate.textContent?.includes(name))!;

    // Membre (events.view) is covered: editable. Secrétaire and Admin give rights the viewer lacks.
    expect(row('Membre').querySelector('a[href="/roles/role-member"]')).not.toBeNull();
    expect(row('Secrétaire').querySelector('a')).toBeNull();
    expect(row('Secrétaire').textContent).toContain('list.lockedAbove');
    expect(row('Admin').querySelector('a')).toBeNull();
    expect(row('Admin').textContent).toContain('list.allPermissions');
  });

  it('marks the viewer’s own role as theirs, and never editable', async () => {
    as(holding('role-treasurer', ['roles.manage', 'events.view']));
    const page = document.createElement('div');
    page.innerHTML = await html(listPage());
    const treasurer = [...page.querySelectorAll('tr')].find((row) =>
      row.textContent?.includes('Trésorier'),
    )!;

    expect(treasurer.querySelector('a')).toBeNull();
    expect(treasurer.textContent).toContain('list.lockedOwn');
  });

  it('flags the default role', async () => {
    as(sessionFor('OWNER'));
    expect(await html(listPage())).toContain('list.default');
  });
});

describe('role edit page', () => {
  it('shows a form to someone who covers the role', async () => {
    as(sessionFor('ADMIN'));
    const out = await html(editPage('role-secretary'));

    expect(out).toContain('<form');
    expect(out).toContain('value="Secrétaire"');
  });

  it('shows a read-only summary, with no form, for a role above the viewer', async () => {
    as(memberWith(['roles.manage'], 'tre-1', 'tre-1'));
    const out = await html(editPage('role-admin'));

    expect(out).not.toContain('<form');
    expect(out).toContain('edit.readOnlyAbove');
  });

  it('shows a read-only summary for the viewer’s own role', async () => {
    as(holding('role-treasurer', ['roles.manage', 'events.view']));
    const out = await html(editPage('role-treasurer'));

    expect(out).not.toContain('<form');
    expect(out).toContain('edit.readOnlyOwn');
  });

  it('is a 404 for a role that does not exist', async () => {
    as(sessionFor('OWNER'));
    await expect(editPage('nope')).rejects.toThrow(NotFoundSignal);
  });
});
