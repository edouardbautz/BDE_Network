import { getTranslations } from 'next-intl/server';
import { signIn } from '@/lib/auth';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { Link, redirect } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (session?.user) {
    redirect({ href: session.user.role === 'PENDING' ? '/pending' : '/dashboard', locale });
    return null;
  }

  const config = getConfig();
  const t = await getTranslations('auth');
  const tNav = await getTranslations('nav');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center gap-1 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, next/image blocks SVG optimization by default */}
          <img src={config.bde.logoPath} alt="" width={40} height={40} className="mb-2" />
          <CardTitle className="text-xl font-semibold tracking-tight">{config.bde.name}</CardTitle>
          <CardDescription>{t('loginSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
      <Link
        href="/privacy"
        className="text-muted-foreground hover:text-foreground rounded-sm text-sm underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {tNav('privacy')}
      </Link>
    </main>
  );
}
