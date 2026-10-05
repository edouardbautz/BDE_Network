import { Clock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { signOut } from '@/lib/auth';
import { getEffectiveSession } from '@/lib/auth/session';
import { redirect } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function PendingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user) {
    redirect({ href: '/', locale });
    return null;
  }

  if (session.user.status !== 'PENDING') {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const t = await getTranslations('pending');
  const tAuth = await getTranslations('auth');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center gap-1">
          <div className="bg-muted text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-full">
            <Clock className="size-5" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">{t('title')}</CardTitle>
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
