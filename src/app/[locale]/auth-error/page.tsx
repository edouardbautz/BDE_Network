import { TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { checkFortyTwoCredentials } from '@/lib/auth/oauth-check';
import { Link, redirect } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('auth', 'errors.title');

const KNOWN_REASONS = ['missing-profile', 'campus-not-allowed'] as const;
type KnownReason = (typeof KNOWN_REASONS)[number];

function isKnownReason(value: string | undefined): value is KnownReason {
  return KNOWN_REASONS.includes(value as KnownReason);
}

export default async function AuthErrorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string; campus?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { reason, campus, error } = await searchParams;
  const session = await getEffectiveSession();

  if (session?.user) {
    redirect({ href: session.user.status === 'PENDING' ? '/pending' : '/dashboard', locale });
    return null;
  }

  const t = await getTranslations('auth.errors');

  // Auth.js reports a refused application (bad secret) as OAuthCallbackError, and anything that went
  // wrong on the platform's side as Configuration: only 42 itself can tell the first from a visitor who
  // simply cancelled on the intra.
  const oauthRejected =
    (error === 'OAuthCallbackError' || error === 'Configuration') &&
    (await checkFortyTwoCredentials()) === 'rejected';

  const message = isKnownReason(reason)
    ? reason === 'campus-not-allowed'
      ? t('campusNotAllowed', { campus: campus ?? '' })
      : t('missingProfile')
    : oauthRejected
      ? t('oauthRejected')
      : error === 'AccessDenied'
        ? t('AccessDenied')
        : error === 'Configuration'
          ? t('Configuration')
          : t('Default');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <div className="fixed top-3 right-3 z-10">
        <LocaleSwitcher />
      </div>
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center gap-1">
          <div className="bg-destructive/10 text-destructive mb-2 flex size-10 items-center justify-center rounded-full">
            <TriangleAlert className="size-5" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">{t('title')}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground rounded-sm text-sm underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t('backToLogin')}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
