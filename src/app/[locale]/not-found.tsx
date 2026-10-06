import { SearchX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { StatusCard } from '@/components/layout/status-card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/** A page that does not exist, outside the signed-in app (login, public pages, any unknown URL). */
export default async function NotFound() {
  const t = await getTranslations('errorPages');

  return (
    <StatusCard
      fullPage
      icon={SearchX}
      title={t('notFound.title')}
      description={t('notFound.description')}
    >
      <Button render={<Link href="/dashboard" />}>{t('backToDashboard')}</Button>
    </StatusCard>
  );
}
