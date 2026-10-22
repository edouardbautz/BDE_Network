import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';

/**
 * The end of the installation. A plain link, not the router: the platform has just changed state (the installer
 * is gone), the next page must be loaded from the server.
 */
export function Done({ locale }: { locale: string }) {
  const t = useTranslations('setup.done');
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-green-600/10 text-green-600">
        <CheckCircle2 className="size-5" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-title-3">{t('title')}</h2>
        <p className="text-muted-foreground text-body">{t('description')}</p>
      </div>
      <a href={`/${locale}`} className={buttonVariants({ size: 'lg' })}>
        {t('signIn')}
      </a>
      <div className="bg-muted/50 flex w-full flex-col gap-2 rounded-lg p-3 text-left text-body">
        <p className="font-semibold">{t('tipsTitle')}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('tipBackground')}</li>
          <li>{t('tipBackup')}</li>
        </ul>
      </div>
    </div>
  );
}
