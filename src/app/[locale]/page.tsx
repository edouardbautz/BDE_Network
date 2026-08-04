import { getTranslations } from 'next-intl/server';
import { auth, signIn } from '@/lib/auth';
import { getConfig } from '@/config';
import { redirect } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  const session = await auth();

  if (session?.user) {
    redirect({ href: session.user.role === 'PENDING' ? '/pending' : '/dashboard', locale });
  }

  const config = getConfig();
  const t = await getTranslations('auth');
  const errorMessage = error
    ? t(error === 'AccessDenied' ? 'errors.AccessDenied' : 'errors.Default')
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, next/image blocks SVG optimization by default */}
          <img src={config.bde.logoPath} alt="" width={48} height={48} />
          <CardTitle className="text-xl">{config.bde.name}</CardTitle>
          <CardDescription>{t('loginSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <form
            action={async () => {
              'use server';
              await signIn('42-school');
            }}
          >
            <Button type="submit" className="w-full">
              {t('loginButton')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
