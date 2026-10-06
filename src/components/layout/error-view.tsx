'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { StatusCard } from './status-card';

interface ErrorViewProps {
  /** The error Next caught. In production it is reduced to its `digest`, a reference for the logs. */
  error: Error & { digest?: string };
  /** Renders the failed part of the page again. */
  reset: () => void;
  fullPage?: boolean;
}

/** What `error.tsx` shows: an apology in plain words, a way to retry and a way out. The error's
 * own message is never displayed (it can describe the server); only its reference is. */
export function ErrorView({ error, reset, fullPage = false }: ErrorViewProps) {
  const t = useTranslations('errorPages');

  return (
    <StatusCard
      fullPage={fullPage}
      icon={TriangleAlert}
      title={t('error.title')}
      description={t('error.description')}
    >
      <div className="flex flex-col gap-2">
        <Button onClick={reset}>{t('error.retry')}</Button>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          {t('backToDashboard')}
        </Button>
      </div>
      {error.digest && (
        <p className="text-muted-foreground text-xs">
          {t('error.reference', { digest: error.digest })}
        </p>
      )}
    </StatusCard>
  );
}
