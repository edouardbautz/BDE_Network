import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const [session, t] = await Promise.all([getEffectiveSession(), getTranslations('privacy')]);
  const bdeName = getConfig().bde.name;
  const dataItems = t.raw('dataCollected.items') as string[];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{t('intro', { bdeName })}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('dataCollected.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('dataCollected.description')}</p>
        <ul className="text-muted-foreground list-inside list-disc text-sm">
          {dataItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">{t('dataCollected.note')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('purpose.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('purpose.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('retention.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('retention.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('rights.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('rights.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('cookies.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('cookies.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('contact.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('contact.description', { bdeName })}</p>
      </section>

      {session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('export.title')}</CardTitle>
            <CardDescription>{t('export.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<a href="/api/me/export" download />}>{t('export.button')}</Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
