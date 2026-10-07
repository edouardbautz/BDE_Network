import { getTranslations } from 'next-intl/server';
import { signIn } from '@/lib/auth';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { isDatabaseReachable } from '@/lib/health';
import { checkFortyTwoCredentials } from '@/lib/auth/oauth-check';
import { TriangleAlert } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('auth', 'loginTitle', { framed: true });

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (session?.user) {
    redirect({ href: session.user.status === 'PENDING' ? '/pending' : '/dashboard', locale });
    return null;
  }

  // Signing in needs the database: say so now instead of failing after the 42 round trip.
  if (!(await isDatabaseReachable())) {
    redirect({ href: '/unavailable', locale });
    return null;
  }

  // 42 refusing this platform's application (expired or regenerated secret) is the operator's to fix:
  // say so, instead of sending the visitor to a 42 error page or a "try again" that cannot work.
  const oauthRejected = (await checkFortyTwoCredentials()) === 'rejected';

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
          {oauthRejected && (
            <div
              role="alert"
              className="bg-destructive/10 flex flex-col gap-2 rounded-lg p-3 text-left text-sm"
            >
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden="true" />
                {t('oauthRejected.title')}
              </p>
              <p>{t('oauthRejected.description')}</p>
              <p className="text-muted-foreground text-xs">{t('oauthRejected.operator')}</p>
            </div>
          )}
          <form
            action={async () => {
              'use server';
              await signIn('42-school');
            }}
          >
            <Button type="submit" className="w-full" disabled={oauthRejected}>
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
