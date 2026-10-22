import { CalendarCheck, CircleCheck, CircleX, Repeat } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CategoryBadge } from '@/components/events/category-badge';
import { EmptyState } from '@/components/events/event-list';
import { EventNoticeAlert } from '@/components/events/event-notice';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { resolveCategory } from '@/lib/events/categories';
import { confirmationNotice } from '@/lib/events/confirmation-notice';
import { formatDateTimeRange, formatLongDate } from '@/lib/events/format';
import { readEventNotice } from '@/lib/events/notice';
import { listProposals } from '@/lib/events/queries';
import { REFUSAL_COMMENT_MAX_LENGTH } from '@/lib/events/review';
import { isRepeating } from '@/lib/events/repeat';
import { summarizeRepeat, summaryInputOf, type RepeatTranslate } from '@/lib/events/repeat-summary';
import { resolveOccurrences } from '@/lib/events/series';
import { pageTitle } from '@/lib/page-title';
import { refuseEvent, setEventStatus } from '../actions';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'review.title');

/**
 * The proposals waiting for a validator, the oldest first, each with its two answers: approve (the event is
 * published for every member) or refuse (it goes back to its author with a comment). For somebody who can validate;
 * for anybody else the page does not exist. The answers are server actions that guard themselves again.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const access = await getEventsAccess();
  if (!access?.canValidate) {
    notFound();
  }

  const [t, tRepeatSummary, locale, raw, proposals] = await Promise.all([
    getTranslations('events'),
    getTranslations('events.repeat.summary'),
    getLocale(),
    searchParams,
    listProposals(),
  ]);
  const tRepeat = tRepeatSummary as unknown as RepeatTranslate;
  const config = getConfig();
  const timeZone = config.bde.timezone;
  const channel = config.notifications.eventConfirmed;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t('review.title')}</h1>
        <p className="text-muted-foreground mt-1 text-body">{t('review.subtitle')}</p>
      </div>

      <EventNoticeAlert notice={readEventNotice(raw.notice)} />

      {proposals.length === 0 ? (
        <Card className="">
          <CardContent>
            <EmptyState title={t('review.emptyTitle')} description={t('review.emptyDescription')} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <ul className="divide-y">
              {proposals.map((event) => {
                const isSeries = isRepeating(event);
                const repeatSummary = summaryInputOf(event, timeZone);
                const dates = resolveOccurrences(event, timeZone).filter((d) => !d.cancelled);
                const first = dates[0];
                const notice = confirmationNotice(channel, event.confirmationNotifiedAt !== null);
                const noticeText =
                  notice === 'notifyChat'
                    ? t('detail.confirmDialog.notifyChat', {
                        channel: channel === 'slack' ? 'Slack' : 'Discord',
                      })
                    : notice
                      ? t(`detail.confirmDialog.${notice}`)
                      : null;
                const author = event.author?.fullName ?? event.authorLogin;

                return (
                  <li
                    key={event.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Link
                        href={{
                          pathname: `/events/${event.id}`,
                          ...(isSeries && first
                            ? { query: { occ: first.originalStart.getTime() } }
                            : {}),
                        }}
                        className="w-fit rounded-sm font-semibold break-words outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {event.title}
                      </Link>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
                        <CategoryBadge category={resolveCategory(event.categoryKey)} />
                        {first && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarCheck className="size-3.5" aria-hidden />
                            <span className="first-letter:uppercase">
                              {formatDateTimeRange(first.start, first.end, locale, timeZone)}
                            </span>
                          </span>
                        )}
                        {repeatSummary && (
                          <span className="inline-flex items-center gap-1">
                            <Repeat className="size-3.5" aria-hidden />
                            {summarizeRepeat(repeatSummary, tRepeat, locale)}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-small">
                        {t('review.proposedBy', {
                          author,
                          date: formatLongDate(
                            event.proposedAt ?? event.createdAt,
                            locale,
                            timeZone,
                          ),
                        })}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <ConfirmDialog
                        tone="destructive"
                        triggerVariant="outline"
                        title={t('detail.review.refuseDialog.title')}
                        description={t('detail.review.refuseDialog.body')}
                        confirmLabel={t('detail.review.refuseDialog.confirm')}
                        field={{
                          label: t('detail.review.refuseDialog.comment'),
                          hint: t('detail.review.refuseDialog.commentHint'),
                          maxLength: REFUSAL_COMMENT_MAX_LENGTH,
                          required: true,
                        }}
                        onConfirm={async (_choice, comment) => {
                          'use server';
                          return refuseEvent(event.id, comment, 'review');
                        }}
                      >
                        <CircleX data-icon="inline-start" />
                        {t('detail.review.refuse')}
                      </ConfirmDialog>
                      <ConfirmDialog
                        tone="default"
                        triggerVariant="default"
                        title={t('detail.review.approveDialog.title')}
                        description={[t('detail.confirmDialog.body'), noticeText]
                          .filter(Boolean)
                          .join(' ')}
                        confirmLabel={t('detail.review.approveDialog.confirm')}
                        onConfirm={async () => {
                          'use server';
                          // A proposal is the whole event: for a series, from its first date.
                          return setEventStatus(
                            event.id,
                            'CONFIRMED',
                            isSeries ? event.startsAt.getTime() : undefined,
                            isSeries ? 'following' : undefined,
                            'review',
                          );
                        }}
                      >
                        <CircleCheck data-icon="inline-start" />
                        {t('detail.review.approve')}
                      </ConfirmDialog>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
