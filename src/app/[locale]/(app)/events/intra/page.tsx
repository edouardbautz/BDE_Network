import { CalendarCheck, Send } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EmptyState } from '@/components/galets/empty-state';
import { IntraNoticeAlert } from '@/components/events/intra-notice';
import { IntraStatusBadge } from '@/components/events/intra-status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getIntraAccess } from '@/lib/events/access';
import { formatDateTimeRange, formatLongDate } from '@/lib/events/format';
import { listIntraRequests } from '@/lib/events/intra-queries';
import { readIntraNotice } from '@/lib/events/intra-notice';
import { intraReadiness, needsStaff } from '@/lib/events/intra-request';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'intra.list.title');

/**
 * The events the school's staff has to publish on the intra, and where each stands: first what waits (a first publication, or an
 * update of an event that changed), then what was answered. For the staff, and for whoever follows the publications (read only):
 * for anybody else the page does not exist. The answers are on the page of each request.
 */
export default async function IntraRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const access = await getIntraAccess();
  if (!access) {
    notFound();
  }

  const [t, locale, raw, requests] = await Promise.all([
    getTranslations('events.intra'),
    getLocale(),
    searchParams,
    listIntraRequests(),
  ]);
  const timeZone = getConfig().bde.timezone;

  const waiting = requests.filter((request) => needsStaff(request.status));
  const answered = requests.filter((request) => !needsStaff(request.status));

  const section = (title: string, rows: typeof requests) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          {rows.map((request) => {
            const readiness = intraReadiness(request.event, timeZone);
            const dates = readiness.ok ? readiness.content.dates : [];
            const first = dates[0];
            return (
              <li
                key={request.id}
                className="border-line flex flex-col gap-1.5 border-t py-4 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/events/intra/${request.eventId}`}
                    className="text-body-strong w-fit rounded-xs break-words hover:underline"
                  >
                    {request.event.title}
                  </Link>
                  <IntraStatusBadge
                    status={request.status}
                    label={t(`status.${request.status}`)}
                  />
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
                  {first && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarCheck className="size-3.5" aria-hidden />
                      <span className="first-letter:uppercase">
                        {formatDateTimeRange(
                          new Date(first.start),
                          new Date(first.end),
                          locale,
                          timeZone,
                        )}
                      </span>
                      {dates.length > 1 && (
                        <span>{t('list.moreDates', { count: dates.length - 1 })}</span>
                      )}
                    </span>
                  )}
                  <span>
                    {t('list.sentBy', {
                      login: request.requestedByLogin,
                      date: formatLongDate(request.requestedAt, locale, timeZone),
                    })}
                  </span>
                </div>
                {request.status === 'OUTDATED' && (
                  <p className="text-small">{t('list.outdatedNote')}</p>
                )}
                {request.status === 'REFUSED' && request.refusalComment && (
                  <p className="text-muted-foreground text-small line-clamp-2 break-words">
                    {t('list.refusedNote', { comment: request.refusalComment })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader title={t('list.title')} />
      <p className="text-body text-muted-foreground -mt-2 mb-4 max-w-[68ch] sm:-mt-3 sm:mb-5">
        {access.canPublish ? t('list.subtitle') : t('list.subtitleReadOnly')}
      </p>
      <div className="flex flex-col gap-3 sm:gap-4">
        <IntraNoticeAlert notice={readIntraNotice(raw.notice)} />

        {requests.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={Send}
                title={t('list.emptyTitle')}
                description={t('list.emptyDescription')}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {waiting.length === 0 ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Send}
                    title={t('list.nothingWaitingTitle')}
                    description={t('list.nothingWaitingDescription')}
                  />
                </CardContent>
              </Card>
            ) : (
              section(t('list.waiting'), waiting)
            )}
            {answered.length > 0 && section(t('list.answered'), answered)}
          </>
        )}
      </div>
    </>
  );
}
