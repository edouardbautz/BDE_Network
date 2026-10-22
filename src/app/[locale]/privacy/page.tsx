import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { getConfig } from '@/config';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('privacy', 'title');

export default async function PrivacyPage() {
  const [session, t] = await Promise.all([getEffectiveSession(), getTranslations('privacy')]);
  const { name: bdeName, contactEmail } = getConfig().bde;
  const dataItems = t.raw('dataCollected.items') as string[];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="fixed top-3 right-3 z-10">
        <LocaleSwitcher />
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 text-body">{t('intro', { bdeName })}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('dataCollected.title')}</h2>
        <p className="text-muted-foreground text-body">{t('dataCollected.description')}</p>
        <ul className="text-muted-foreground list-inside list-disc text-body">
          {dataItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-body">{t('dataCollected.note')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('purpose.title')}</h2>
        <p className="text-muted-foreground text-body">{t('purpose.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('notifications.title')}</h2>
        <p className="text-muted-foreground text-body">{t('notifications.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('calendar.title')}</h2>
        <p className="text-muted-foreground text-body">{t('calendar.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('retention.title')}</h2>
        <p className="text-muted-foreground text-body">{t('retention.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('rights.title')}</h2>
        <p className="text-muted-foreground text-body">{t('rights.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('cookies.title')}</h2>
        <p className="text-muted-foreground text-body">{t('cookies.description')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body-strong">{t('contact.title')}</h2>
        <p className="text-muted-foreground text-body">
          {contactEmail ? (
            <>
              {t('contact.withAddress')}{' '}
              <a href={`mailto:${contactEmail}`} className="text-foreground underline">
                {contactEmail}
              </a>
              .
            </>
          ) : (
            t('contact.description', { bdeName })
          )}
        </p>
      </section>

      {session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body">{t('export.title')}</CardTitle>
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
