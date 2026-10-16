import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { canValidateEvents, canViewEvents } from '@/lib/events/access';
import { countProposals } from '@/lib/events/queries';
import { isDatabaseReachable } from '@/lib/health';
import {
  can,
  canManageSettings,
  canViewAuditLog,
  MEMBERS_MANAGE,
  ROLES_MANAGE,
} from '@/lib/permissions';
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
  // Whoever can validate sees what waits for them, counted, in the menu. The permission exists only while the
  // events module is enabled.
  if (canValidateEvents(session.user)) {
    const waiting = await countProposals();
    navItems.push({
      id: 'eventsReview',
      href: '/events/review',
      label: t('eventsReview'),
      badge: waiting,
      badgeLabel: t('eventsReviewCount', { count: waiting }),
    });
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
  if (canManageSettings(session.user)) {
    navItems.push({ id: 'settings', href: '/settings', label: t('settings') });
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
