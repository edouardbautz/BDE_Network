import { ArrowLeft, CalendarSync, CircleCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyField } from '@/components/events/copy-field';
import { EmptyState } from '@/components/events/event-list';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link, redirect } from '@/i18n/navigation';
import { canManageSharedCalendar, getEventsAccess } from '@/lib/events/access';
import { getBdeFeedToken } from '@/lib/events/export';
import { getOrigin } from '@/lib/events/origin';
import { disableSharedCalendar, enableSharedCalendar, regenerateSharedCalendar } from './actions';

export const dynamic = 'force-dynamic';

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
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link href="/events" />}
      >
        <ArrowLeft data-icon="inline-start" />
        {t('back')}
      </Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t('subtitle')}</p>
      </div>

      {status && (
        <Alert>
          <CircleCheck />
          <AlertDescription>{t(`status.${status}`)}</AlertDescription>
        </Alert>
      )}

      {!feedUrl ? (
        <Card className="max-w-3xl border-dashed">
          <CardContent>
            <EmptyState
              title={t('inactive.title')}
              description={t('inactive.description')}
              action={
                <form
                  action={async () => {
                    'use server';
                    await enableSharedCalendar();
                  }}
                >
                  <Button type="submit" size="sm">
                    {t('inactive.enable')}
                  </Button>
                </form>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarSync className="text-muted-foreground size-4" />
              {t('active.title')}
            </CardTitle>
            <CardDescription>{t('active.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <CopyField id="bde-feed-url" value={feedUrl} label={t('active.linkLabel')} />

            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
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
                  await regenerateSharedCalendar();
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
                  await disableSharedCalendar();
                }}
              >
                {t('disable.summary')}
              </ConfirmDialog>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
