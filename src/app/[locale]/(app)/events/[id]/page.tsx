import {
  ArrowLeft,
  CalendarPlus,
  CircleCheck,
  FileText,
  MapPin,
  Pencil,
  Repeat,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CategoryBadge } from '@/components/events/category-badge';
import { EventNoticeAlert } from '@/components/events/event-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { resolveCategory } from '@/lib/events/categories';
import { formatDateTimeRange, formatLongDate, formatTimeRange } from '@/lib/events/format';
import { readEventNotice } from '@/lib/events/notice';
import { getVisibleEvent } from '@/lib/events/queries';
import { allOccurrences } from '@/lib/events/recurrence';
import { cn } from '@/lib/utils';
import { cancelOccurrence, deleteEvent, restoreOccurrence, setEventStatus } from '../actions';

export const dynamic = 'force-dynamic';

const MAX_LISTED_OCCURRENCES = 40;

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd className="text-sm break-words">{children}</dd>
      </div>
    </div>
  );
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occ?: string | string[]; notice?: string | string[] }>;
}) {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }

  const [{ id }, rawSearch, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('events'),
    getLocale(),
  ]);

  const event = await getVisibleEvent(id, access.canManage);
  if (!event) {
    notFound();
  }

  const timeZone = getConfig().bde.timezone;
  const category = resolveCategory(event.categoryKey);
  const cancelledStarts = new Set(event.cancellations.map((c) => c.occurrenceStart.getTime()));
  const occurrences = allOccurrences(event, timeZone).map((occurrence) => ({
    ...occurrence,
    cancelled: cancelledStarts.has(occurrence.start.getTime()),
  }));

  const now = Date.now();
  const isSeries = event.recurrence !== 'NONE';
  const requested = Array.isArray(rawSearch.occ) ? rawSearch.occ[0] : rawSearch.occ;
  const live = occurrences.filter((o) => !o.cancelled);
  const shown =
    occurrences.find((o) => String(o.start.getTime()) === requested) ??
    live.find((o) => o.end.getTime() >= now) ??
    live[live.length - 1] ??
    occurrences[0];

  if (!shown) {
    notFound();
  }

  const upcoming = occurrences.filter((o) => o.end.getTime() >= now);
  const pastCount = occurrences.length - upcoming.length;
  const nextStatus = event.status === 'DRAFT' ? 'CONFIRMED' : 'DRAFT';

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link href="/events" />}
      >
        <ArrowLeft data-icon="inline-start" />
        {t('detail.back')}
      </Button>

      <EventNoticeAlert notice={readEventNotice(rawSearch.notice)} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{event.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <CategoryBadge category={category} />
            <Badge variant={event.status === 'DRAFT' ? 'outline' : 'secondary'}>
              {t(`status.${event.status}`)}
            </Badge>
            {shown.cancelled && (
              <Badge variant="destructive">{t('detail.occurrenceCancelled')}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={`/api/events/${event.id}/ics?occ=${shown.start.getTime()}`} download />
            }
          >
            <CalendarPlus data-icon="inline-start" />
            {t('detail.addToCalendar')}
          </Button>
          {access.canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/events/${event.id}/edit`} />}
              >
                <Pencil data-icon="inline-start" />
                {t('detail.edit')}
              </Button>
              <form
                action={async () => {
                  'use server';
                  await setEventStatus(event.id, nextStatus);
                }}
              >
                <Button
                  size="sm"
                  variant={event.status === 'DRAFT' ? 'default' : 'secondary'}
                  type="submit"
                >
                  {event.status === 'DRAFT' ? (
                    <CircleCheck data-icon="inline-start" />
                  ) : (
                    <Undo2 data-icon="inline-start" />
                  )}
                  {event.status === 'DRAFT' ? t('detail.confirm') : t('detail.backToDraft')}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent>
          <dl className="flex flex-col gap-4">
            <DetailRow icon={CalendarPlus} label={t('detail.when')}>
              <span className="first-letter:uppercase">
                {formatDateTimeRange(shown.start, shown.end, locale, timeZone)}
              </span>
            </DetailRow>
            {isSeries && event.recurrenceUntil && (
              <DetailRow icon={Repeat} label={t('detail.repeats')}>
                {t('detail.repeatsValue', {
                  frequency: t(`recurrence.${event.recurrence}`),
                  until: formatLongDate(event.recurrenceUntil, locale, timeZone),
                })}
              </DetailRow>
            )}
            {event.location && (
              <DetailRow icon={MapPin} label={t('detail.where')}>
                {event.location}
              </DetailRow>
            )}
            <DetailRow icon={Users} label={t('detail.inCharge')}>
              {event.assignees.length > 0 ? (
                event.assignees.map((a) => a.user?.fullName ?? a.login).join(', ')
              ) : (
                <span className="text-muted-foreground">{t('detail.noneInCharge')}</span>
              )}
            </DetailRow>
            {event.description && (
              <DetailRow icon={FileText} label={t('detail.description')}>
                <span className="whitespace-pre-wrap">{event.description}</span>
              </DetailRow>
            )}
          </dl>
          <p className="text-muted-foreground mt-6 border-t pt-4 text-xs">
            {t('detail.meta', { author: event.authorLogin, schoolYear: event.schoolYear })}
          </p>
        </CardContent>
      </Card>

      {isSeries && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.occurrences.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('detail.occurrences.allPast')}</p>
            ) : (
              <ul className="divide-y">
                {upcoming.slice(0, MAX_LISTED_OCCURRENCES).map((occurrence) => {
                  const startMs = occurrence.start.getTime();
                  return (
                    <li
                      key={startMs}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          href={{ pathname: `/events/${event.id}`, query: { occ: startMs } }}
                          className={cn(
                            'rounded-sm text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50',
                            occurrence.cancelled && 'text-muted-foreground line-through',
                            startMs === shown.start.getTime() && 'font-medium',
                          )}
                        >
                          <span className="first-letter:uppercase">
                            {formatLongDate(occurrence.start, locale, timeZone)}
                          </span>{' '}
                          · {formatTimeRange(occurrence.start, occurrence.end, locale, timeZone)}
                        </Link>
                        {occurrence.cancelled && (
                          <Badge variant="destructive">{t('detail.occurrenceCancelled')}</Badge>
                        )}
                      </div>
                      {access.canManage &&
                        (occurrence.cancelled ? (
                          <form
                            action={async () => {
                              'use server';
                              await restoreOccurrence(event.id, startMs);
                            }}
                          >
                            <Button size="xs" variant="outline" type="submit">
                              {t('detail.occurrences.restore')}
                            </Button>
                          </form>
                        ) : (
                          <ConfirmDialog
                            triggerSize="xs"
                            triggerVariant="outline"
                            title={t('detail.occurrences.cancelTitle')}
                            description={t('detail.occurrences.cancelWarning', {
                              date: formatLongDate(occurrence.start, locale, timeZone),
                            })}
                            confirmLabel={t('detail.occurrences.cancelConfirm')}
                            onConfirm={async () => {
                              'use server';
                              await cancelOccurrence(event.id, startMs);
                            }}
                          >
                            {t('detail.occurrences.cancel')}
                          </ConfirmDialog>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
            {upcoming.length > MAX_LISTED_OCCURRENCES && (
              <p className="text-muted-foreground mt-3 text-xs">
                {t('detail.occurrences.truncated', {
                  count: upcoming.length - MAX_LISTED_OCCURRENCES,
                })}
              </p>
            )}
            {pastCount > 0 && (
              <p className="text-muted-foreground mt-3 text-xs">
                {t('detail.occurrences.past', { count: pastCount })}
              </p>
            )}
            <div className="mt-4 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                render={<a href={`/api/events/${event.id}/ics`} download />}
              >
                <CalendarPlus data-icon="inline-start" />
                {t('detail.addSeriesToCalendar')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {access.canManage && (
        <div>
          <ConfirmDialog
            title={isSeries ? t('detail.delete.titleSeries') : t('detail.delete.title')}
            description={isSeries ? t('detail.delete.warningSeries') : t('detail.delete.warning')}
            confirmLabel={t('detail.delete.confirm')}
            onConfirm={async () => {
              'use server';
              await deleteEvent(event.id);
            }}
          >
            <Trash2 data-icon="inline-start" />
            {t('detail.delete.button')}
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}
