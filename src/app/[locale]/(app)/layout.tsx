import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { canViewEvents } from '@/lib/events/access';
import { isDatabaseReachable } from '@/lib/health';
import { can, canViewAuditLog, MEMBERS_MANAGE, ROLES_MANAGE } from '@/lib/permissions';
import { accountLabel } from '@/lib/account-label';
import { redirect } from '@/i18n/navigation';
import { AppShell, type NavItem } from '@/components/layout/app-shell';
import { UserMenu } from '@/components/layout/user-menu';
import { Footer } from '@/components/layout/footer';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user) {
    // With the database down Auth.js reports no session: don't send a signed-in
    // member to the login page as if they had been logged out.
    if (!(await isDatabaseReachable())) {
      redirect({ href: '/unavailable', locale });
      return null;
    }
    redirect({ href: '/', locale });
    return null;
  }

  if (session.user.status === 'PENDING') {
    redirect({ href: '/pending', locale });
    return null;
  }

  const config = getConfig();
  const [t, tRoles] = await Promise.all([getTranslations('nav'), getTranslations('roles')]);

  const navItems: NavItem[] = [{ id: 'dashboard', href: '/dashboard', label: t('dashboard') }];
  if (canViewEvents(session.user)) {
    navItems.push({ id: 'events', href: '/events', label: t('events') });
  }
  if (can(session.user, MEMBERS_MANAGE)) {
    navItems.push({ id: 'members', href: '/members', label: t('members') });
  }
  if (can(session.user, ROLES_MANAGE)) {
    navItems.push({ id: 'roles', href: '/roles', label: t('roles') });
  }
  if (canViewAuditLog(session.user)) {
    navItems.push({ id: 'auditLog', href: '/audit-log', label: t('auditLog') });
  }

  return (
    <AppShell
      bdeName={config.bde.name}
      logoPath={config.bde.logoPath}
      navItems={navItems}
      menuLabel={t('openMenu')}
      navLabel={t('menuTitle')}
      navDescription={t('menuDescription')}
      skipLabel={t('skipToContent')}
      userMenu={
        <UserMenu
          name={session.user.name ?? session.user.login}
          login={session.user.login}
          image={session.user.image ?? null}
          roleLabel={accountLabel(session.user, tRoles)}
        />
      }
      footer={<Footer />}
    >
      {children}
    </AppShell>
  );
}
