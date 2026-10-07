import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { CodeForm } from '@/components/setup/code-form';
import { SetupWizard } from '@/components/setup/wizard';
import { toView } from '@/lib/setup/draft';
import { isSetupMode } from '@/lib/setup/guard';
import { getSetupSession, requestOrigin } from '@/lib/setup/session';

export const dynamic = 'force-dynamic';

/** Its own title: the platform has no name yet, the one the layout would add is the template's. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'setup' });
  return { title: { absolute: `${t('title')} · BDE_Network` }, robots: { index: false } };
}

/**
 * The installer. It exists only while the platform is not installed (404 afterwards, for good), shows nothing
 * but the code form until the code of the server's logs is given, and then walks through the steps.
 */
export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!isSetupMode()) notFound();

  const t = await getTranslations('setup');
  const session = await getSetupSession();
  const other = locale === 'fr' ? 'en' : 'fr';

  const brand = (
    <p className="text-sm font-semibold tracking-tight">
      BDE_Network <span className="text-muted-foreground font-normal">· {t('heading')}</span>
    </p>
  );
  const switcher = (
    <Link
      href="/setup"
      locale={other}
      lang={other}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-3"
    >
      {other === 'en' ? 'English' : 'Français'}
    </Link>
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-xl">
        <CardContent className="flex flex-col gap-6">
          {session ? (
            <SetupWizard
              initial={toView(session.draft, { addressUrl: await requestOrigin() })}
              locale={locale}
              brand={brand}
              switcher={switcher}
            />
          ) : (
            <>
              <header className="flex items-center justify-between gap-4">
                {brand}
                {switcher}
              </header>
              <CodeForm />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
