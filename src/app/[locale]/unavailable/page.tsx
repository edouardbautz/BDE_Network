import { CloudOff } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/lib/page-title';
import { UnavailableRetry } from '@/components/layout/unavailable-retry';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const title = pageTitle('unavailable', 'title');

export async function generateMetadata(props: Parameters<typeof title>[0]): Promise<Metadata> {
  return { ...(await title(props)), robots: { index: false } };
}

/** Where visitors land when the database cannot be reached (see isDatabaseReachable).
 * Public and free of any data access, so it renders even while everything else is down. */
export default async function UnavailablePage() {
  const t = await getTranslations('unavailable');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center gap-1">
          <div className="bg-accent-soft text-accent-ink mb-2 flex size-14 items-center justify-center rounded-xl">
            <CloudOff className="size-7" />
          </div>
          <h1 className="text-title-2">{t('title')}</h1>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-body">{t('autoRetry')}</p>
          <UnavailableRetry />
          <p className="text-muted-foreground text-small">{t('help')}</p>
        </CardContent>
      </Card>
    </main>
  );
}
