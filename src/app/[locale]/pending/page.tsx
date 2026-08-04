import { getTranslations } from 'next-intl/server';
import { auth, signOut } from '@/lib/auth';
import { redirect } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function PendingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect({ href: '/', locale });
    return null;
  }

  if (session.user.role !== 'PENDING') {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const t = await getTranslations('pending');
  const tAuth = await getTranslations('auth');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            {t('signedInAs', {
              name: session.user.name ?? session.user.login,
              login: session.user.login,
            })}
          </p>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
          >
            <Button type="submit" variant="outline" className="w-full">
              {tAuth('logout')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
