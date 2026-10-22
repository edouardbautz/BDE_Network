import { CalendarSync, CircleCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/action-button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyField } from '@/components/events/copy-field';
import { EmptyState } from '@/components/galets/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from '@/i18n/navigation';
import { canManageSharedCalendar, getEventsAccess } from '@/lib/events/access';
import { getBdeFeedToken } from '@/lib/events/export';
import { getOrigin } from '@/lib/events/origin';
import { disableSharedCalendar, enableSharedCalendar, regenerateSharedCalendar } from './actions';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'sharedCalendar.title');

const STATUSES = ['enabled', 'regenerated', 'disabled'] as const;

export default async function SharedCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }
  if (!canManageSharedCalendar(access.session.user)) {
    // The BDE link needs events.shared_calendar; anyone else goes back to the events.
    redirect({ href: '/events', locale: await getLocale() });
  }

  const [t, tProfile, rawSearch, token] = await Promise.all([
    getTranslations('events.sharedCalendar'),
    getTranslations('profile.calendar'),
    searchParams,
    getBdeFeedToken(),
  ]);

  const requestedStatus = Array.isArray(rawSearch.status) ? rawSearch.status[0] : rawSearch.status;
  const status = STATUSES.find((value) => value === requestedStatus);
  const feedUrl = token ? `${await getOrigin()}/api/calendar/bde/${token}.ics` : null;

  return (
    <>
      <PageHeader title={t('title')} back={{ href: '/events', label: t('back') }} />
      <p className="text-body text-muted-foreground -mt-2 mb-4 max-w-[68ch] sm:-mt-3 sm:mb-5">
        {t('subtitle')}
      </p>
      <div className="flex flex-col gap-3 sm:gap-4">
        {status && (
          <Alert>
            <CircleCheck />
            <AlertDescription>{t(`status.${status}`)}</AlertDescription>
          </Alert>
        )}

        {!feedUrl ? (
          <Card className="max-w-3xl">
            <CardContent>
              <EmptyState
                icon={CalendarSync}
                title={t('inactive.title')}
                description={t('inactive.description')}
                action={
                  <ActionButton
                    variant="default"
                    action={async () => {
                      'use server';
                      return enableSharedCalendar();
                    }}
                  >
                    {t('inactive.enable')}
                  </ActionButton>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>{t('active.title')}</CardTitle>
              <CardDescription>{t('active.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CopyField id="bde-feed-url" value={feedUrl} label={t('active.linkLabel')} />

              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-body">
                <li>{t('active.confirmedOnly')}</li>
                <li>{tProfile('google')}</li>
                <li>{tProfile('outlook')}</li>
                <li>{tProfile('apple')}</li>
                <li>{t('active.guide')}</li>
              </ul>

              <Alert>
                <AlertDescription>{t('active.limit')}</AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-3">
                <ConfirmDialog
                  title={t('regenerate.title')}
                  description={t('regenerate.warning')}
                  confirmLabel={t('regenerate.confirm')}
                  onConfirm={async () => {
                    'use server';
                    return regenerateSharedCalendar();
                  }}
                >
                  {t('regenerate.summary')}
                </ConfirmDialog>

                <ConfirmDialog
                  title={t('disable.title')}
                  description={t('disable.warning')}
                  confirmLabel={t('disable.confirm')}
                  onConfirm={async () => {
                    'use server';
                    return disableSharedCalendar();
                  }}
                >
                  {t('disable.summary')}
                </ConfirmDialog>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
