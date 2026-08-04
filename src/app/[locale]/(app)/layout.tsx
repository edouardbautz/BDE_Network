import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getConfig } from '@/config';
import { canManageMembers, canViewAuditLog } from '@/lib/permissions';
import { redirect } from '@/i18n/navigation';
import { Navbar } from '@/components/layout/navbar';
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
  const session = await auth();

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

  const navItems = [{ href: '/dashboard', label: t('dashboard') }];
  if (canManageMembers(session.user.role)) {
    navItems.push({ href: '/members', label: t('members') });
  }
  if (canViewAuditLog(session.user.role)) {
    navItems.push({ href: '/audit-log', label: t('auditLog') });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar
        bdeName={config.bde.name}
        logoPath={config.bde.logoPath}
        navItems={navItems}
        user={{
          name: session.user.name ?? session.user.login,
          login: session.user.login,
          image: session.user.image ?? null,
          role: session.user.role,
        }}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      <Footer />
    </div>
  );
}
