import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { isEventsModuleEnabled } from '@/lib/events/access';
import { canManageMembers, canViewAuditLog } from '@/lib/permissions';
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
    redirect({ href: '/', locale });
    return null;
  }

  if (session.user.role === 'PENDING') {
    redirect({ href: '/pending', locale });
    return null;
  }

  const config = getConfig();
  const t = await getTranslations('nav');

  const navItems: NavItem[] = [{ id: 'dashboard', href: '/dashboard', label: t('dashboard') }];
  if (isEventsModuleEnabled()) {
    navItems.push({ id: 'events', href: '/events', label: t('events') });
  }
  if (canManageMembers(session.user.role)) {
    navItems.push({ id: 'members', href: '/members', label: t('members') });
  }
  if (canViewAuditLog(session.user.role)) {
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
      userMenu={
        <UserMenu
          name={session.user.name ?? session.user.login}
          login={session.user.login}
          image={session.user.image ?? null}
          role={session.user.role}
        />
      }
      footer={<Footer />}
    >
      {children}
    </AppShell>
  );
}
