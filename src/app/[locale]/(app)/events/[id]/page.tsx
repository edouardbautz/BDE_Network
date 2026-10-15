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
import { ActionButton } from '@/components/action-button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CategoryBadge } from '@/components/events/category-badge';
import { EventNoticeAlert } from '@/components/events/event-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { confirmationNotice } from '@/lib/events/confirmation-notice';
import { resolveCategory } from '@/lib/events/categories';
import { formatDateTimeRange, formatLongDate, formatTimeRange } from '@/lib/events/format';
import { readEventNotice } from '@/lib/events/notice';
import { getVisibleEvent } from '@/lib/events/queries';
import { resolveOccurrences, scopeFacts } from '@/lib/events/series';
import { cn } from '@/lib/utils';
import {
  cancelOccurrence,
  deleteEvent,
  deleteFollowingDates,
  restoreOccurrence,
  setEventStatus,
} from '../actions';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'title');

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
  const allDates = resolveOccurrences(event, timeZone);
  // A reader who cannot see drafts sees the dates that are confirmed, and none of the others.
  const occurrences = access.canManage
    ? allDates
    : allDates.filter((o) => o.status === 'CONFIRMED');

  const now = Date.now();
  const isSeries = event.recurrence !== 'NONE';
  const requested = Array.isArray(rawSearch.occ) ? rawSearch.occ[0] : rawSearch.occ;
  const live = occurrences.filter((o) => !o.cancelled);
  const shown =
    occurrences.find((o) => String(o.originalStart.getTime()) === requested) ??
    live.find((o) => o.end.getTime() >= now) ??
    live[live.length - 1] ??
    occurrences[0];

  if (!shown) {
    notFound();
  }

  const category = resolveCategory(shown.categoryKey);
  const occurrence = shown.originalStart.getTime();
  const upcoming = occurrences.filter((o) => o.end.getTime() >= now);
  const pastCount = occurrences.length - upcoming.length;
  const facts = scopeFacts(allDates, shown.originalStart);

  // What the dialogs of a series say: the same two choices for every action, each with what it does here.
  const followingLabel = facts.isFirst ? t('scope.followingFirst') : t('scope.following');
  const followingHint = facts.isFirst
    ? t('scope.followingFirstHint', { count: facts.total })
    : t('scope.followingHint', { count: facts.following });
  const choices = (hints: { occurrence: string; following: string }) => [
    { value: 'occurrence', label: t('scope.occurrence'), hint: hints.occurrence },
    { value: 'following', label: followingLabel, hint: hints.following },
  ];

  const channel = getConfig().notifications.eventConfirmed;
  const noticeFor = (alreadyNotified: boolean): string | null => {
    const notice = confirmationNotice(channel, alreadyNotified);
    return notice === 'notifyChat'
      ? t('detail.confirmDialog.notifyChat', { channel: channel === 'slack' ? 'Slack' : 'Discord' })
      : notice
        ? t(`detail.confirmDialog.${notice}`)
        : null;
  };
  const sentence = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ');
  const confirmationText = sentence(
    t('detail.confirmDialog.body'),
    noticeFor(event.confirmationNotifiedAt !== null),
  );

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
          <h1 className="text-2xl font-semibold tracking-tight break-words">{shown.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <CategoryBadge category={category} />
            <Badge variant={shown.status === 'DRAFT' ? 'outline' : 'secondary'}>
              {t(`status.${shown.status}`)}
            </Badge>
            {isSeries && shown.edited && (
              <Badge variant="outline">{t('detail.occurrenceEdited')}</Badge>
            )}
            {shown.cancelled && (
              <Badge variant="destructive">{t('detail.occurrenceCancelled')}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<a href={`/api/events/${event.id}/ics?occ=${occurrence}`} download />}
          >
            <CalendarPlus data-icon="inline-start" />
            {t('detail.addToCalendar')}
          </Button>
          {access.canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={
                      isSeries
                        ? { pathname: `/events/${event.id}/edit`, query: { occ: occurrence } }
                        : `/events/${event.id}/edit`
                    }
                  />
                }
              >
                <Pencil data-icon="inline-start" />
                {t('detail.edit')}
              </Button>
              {shown.cancelled && (
                <ActionButton
                  action={async () => {
                    'use server';
                    return restoreOccurrence(event.id, occurrence);
                  }}
                >
                  {t('detail.restoreDate')}
                </ActionButton>
              )}
              {shown.status === 'DRAFT' ? (
                // Confirming shows the event to every member and may notify them: it asks first,
                // in the normal style (it is not destructive: going back to draft undoes it).
                isSeries ? (
                  <ConfirmDialog
                    tone="default"
                    triggerVariant="default"
                    title={t('detail.confirmDialog.title')}
                    description={t('detail.confirmDialog.body')}
                    confirmLabel={t('detail.confirmDialog.confirm')}
                    choices={choices({
                      occurrence: sentence(
                        t('scope.occurrenceHint'),
                        t('scope.confirmOccurrence'),
                        noticeFor(shown.announcedAt !== null),
                      ),
                      following: sentence(
                        followingHint,
                        facts.drafts > 0 ? t('scope.draftNote', { count: facts.drafts }) : null,
                        t('scope.confirmFollowing'),
                        noticeFor(event.confirmationNotifiedAt !== null),
                      ),
                    })}
                    onConfirm={async (scope) => {
                      'use server';
                      return setEventStatus(event.id, 'CONFIRMED', occurrence, scope);
                    }}
                  >
                    <CircleCheck data-icon="inline-start" />
                    {t('detail.confirm')}
                  </ConfirmDialog>
                ) : (
                  <ConfirmDialog
                    tone="default"
                    triggerVariant="default"
                    title={t('detail.confirmDialog.title')}
                    description={confirmationText}
                    confirmLabel={t('detail.confirmDialog.confirm')}
                    onConfirm={async () => {
                      'use server';
                      return setEventStatus(event.id, 'CONFIRMED');
                    }}
                  >
                    <CircleCheck data-icon="inline-start" />
                    {t('detail.confirm')}
                  </ConfirmDialog>
                )
              ) : isSeries ? (
                <ConfirmDialog
                  tone="default"
                  triggerVariant="secondary"
                  title={t('scope.backToDraft.title')}
                  description={t('scope.backToDraft.description')}
                  confirmLabel={t('scope.backToDraft.confirm')}
                  choices={choices({
                    occurrence: t('scope.occurrenceHint'),
                    following: followingHint,
                  })}
                  onConfirm={async (scope) => {
                    'use server';
                    return setEventStatus(event.id, 'DRAFT', occurrence, scope);
                  }}
                >
                  <Undo2 data-icon="inline-start" />
                  {t('detail.backToDraft')}
                </ConfirmDialog>
              ) : (
                <ActionButton
                  variant="secondary"
                  action={async () => {
                    'use server';
                    return setEventStatus(event.id, 'DRAFT');
                  }}
                >
                  <Undo2 data-icon="inline-start" />
                  {t('detail.backToDraft')}
                </ActionButton>
              )}
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
            {shown.location && (
              <DetailRow icon={MapPin} label={t('detail.where')}>
                {shown.location}
              </DetailRow>
            )}
            <DetailRow icon={Users} label={t('detail.inCharge')}>
              {shown.assignees.length > 0 ? (
                shown.assignees.map((a) => a.user?.fullName ?? a.login).join(', ')
              ) : (
                <span className="text-muted-foreground">{t('detail.noneInCharge')}</span>
              )}
            </DetailRow>
            {shown.description && (
              <DetailRow icon={FileText} label={t('detail.description')}>
                <span className="whitespace-pre-wrap">{shown.description}</span>
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
                {upcoming.slice(0, MAX_LISTED_OCCURRENCES).map((date) => {
                  const key = date.originalStart.getTime();
                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          href={{ pathname: `/events/${event.id}`, query: { occ: key } }}
                          className={cn(
                            'rounded-sm text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50',
                            date.cancelled && 'text-muted-foreground line-through',
                            key === occurrence && 'font-medium',
                          )}
                        >
                          <span className="first-letter:uppercase">
                            {formatLongDate(date.start, locale, timeZone)}
                          </span>{' '}
                          · {formatTimeRange(date.start, date.end, locale, timeZone)}
                        </Link>
                        {date.cancelled && (
                          <Badge variant="destructive">{t('detail.occurrenceCancelled')}</Badge>
                        )}
                        {date.status === 'DRAFT' && (
                          <Badge variant="outline">{t('status.DRAFT')}</Badge>
                        )}
                        {date.edited && (
                          <Badge variant="outline">{t('detail.occurrenceEdited')}</Badge>
                        )}
                      </div>
                      {access.canManage && date.cancelled && (
                        <ActionButton
                          size="xs"
                          action={async () => {
                            'use server';
                            return restoreOccurrence(event.id, key);
                          }}
                        >
                          {t('detail.occurrences.restore')}
                        </ActionButton>
                      )}
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
          {isSeries ? (
            <ConfirmDialog
              title={t('scope.delete.title')}
              description={t('scope.delete.description')}
              confirmLabel={t('scope.delete.confirm')}
              choices={choices({
                occurrence: t('scope.delete.occurrenceHint'),
                following: facts.isFirst
                  ? t('scope.delete.followingFirstHint', { count: facts.total })
                  : t('scope.delete.followingHint', { count: facts.following }),
              })}
              onConfirm={async (scope) => {
                'use server';
                if (scope === 'following') {
                  return deleteFollowingDates(event.id, occurrence);
                }
                if (scope === 'occurrence') {
                  return cancelOccurrence(event.id, occurrence);
                }
                throw new Error('Invalid scope');
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t('scope.delete.button')}
            </ConfirmDialog>
          ) : (
            <ConfirmDialog
              title={t('detail.delete.title')}
              description={t('detail.delete.warning')}
              confirmLabel={t('detail.delete.confirm')}
              onConfirm={async () => {
                'use server';
                await deleteEvent(event.id);
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t('detail.delete.button')}
            </ConfirmDialog>
          )}
        </div>
      )}
    </div>
  );
}
