import {
  CalendarPlus,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  MapPin,
  Pencil,
  Repeat,
  Send,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { channelsFor } from '@/config/schema';
import { ActionButton } from '@/components/action-button';
import { IntraNoticeAlert } from '@/components/events/intra-notice';
import { IntraStatusBadge } from '@/components/events/intra-status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CategoryBadge } from '@/components/events/category-badge';
import { EventNoticeAlert } from '@/components/events/event-notice';
import { Markdown } from '@/components/markdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getEventsAccess, getIntraAccess } from '@/lib/events/access';
import { chatNames, confirmationNotice } from '@/lib/events/confirmation-notice';
import { resolveCategory } from '@/lib/events/categories';
import { formatDateTimeRange, formatLongDate, formatTimeRange } from '@/lib/events/format';
import { intraOf } from '@/lib/events/intra';
import { intraPublicationEnabled } from '@/lib/events/intra-config';
import { readIntraNotice } from '@/lib/events/intra-notice';
import { getIntraRequestOfEvent } from '@/lib/events/intra-queries';
import { intraReadiness, isOnIntra } from '@/lib/events/intra-request';
import { readEventNotice } from '@/lib/events/notice';
import { getVisibleEvent } from '@/lib/events/queries';
import {
  REFUSAL_COMMENT_MAX_LENGTH,
  canDeleteEvent,
  draftVisibility,
  editRefusal,
  reviewActorOf,
} from '@/lib/events/review';
import { isRepeating } from '@/lib/events/repeat';
import { summarizeRepeat, summaryInputOf, type RepeatTranslate } from '@/lib/events/repeat-summary';
import { resolveOccurrences, scopeFacts } from '@/lib/events/series';
import { cn } from '@/lib/utils';
import {
  cancelOccurrence,
  deleteEvent,
  deleteFollowingDates,
  refuseEvent,
  restoreOccurrence,
  setEventStatus,
} from '../actions';
import { requestOnIntra } from '../intra/actions';
import { PageHeader } from '@/components/layout/page-header';
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
    // A description list only holds terms and descriptions (a group may be wrapped in a div, which then holds nothing
    // else): the icon sits inside the term, and the description is indented by the width of the icon and its gap.
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-small text-muted-foreground flex items-center gap-3">
        <span className="bg-accent-soft text-accent-ink flex size-7 shrink-0 items-center justify-center rounded-xs">
          <Icon className="size-4" aria-hidden />
        </span>
        {label}
      </dt>
      <dd className="text-body pl-10 break-words">{children}</dd>
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

  const [{ id }, rawSearch, t, tRepeatSummary, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('events'),
    getTranslations('events.repeat.summary'),
    getLocale(),
  ]);
  const tRepeat = tRepeatSummary as unknown as RepeatTranslate;

  const visibility = draftVisibility(access);
  const event = await getVisibleEvent(id, visibility);
  if (!event) {
    notFound();
  }

  const timeZone = getConfig().bde.timezone;
  const allDates = resolveOccurrences(event, timeZone);
  // A reader who cannot see what is not published (a draft, a proposal) sees the dates that are confirmed, and
  // none of the others; a validator sees all, and an author their own event.
  const seesUnpublished =
    visibility.includeDrafts ||
    (visibility.ownLogin !== undefined && visibility.ownLogin === event.authorLogin);
  const occurrences = seesUnpublished ? allDates : allDates.filter((o) => o.status === 'CONFIRMED');

  // What this person may do to the event, decided by the rules of the circuit (lib/events/review.ts).
  const actor = reviewActorOf(access);
  const reviewed = {
    status: event.status,
    authorLogin: event.authorLogin,
    dateStatuses: event.occurrences.map((own) => own.status),
  };
  const lockedBecause = editRefusal(actor, reviewed);
  const mayEdit = lockedBecause === null;
  const mayDelete = canDeleteEvent(actor, reviewed);
  const isValidator = access.canValidate;
  const isProposerOnly = !isValidator && access.canPropose;

  const now = Date.now();
  const isSeries = isRepeating(event);
  const intra = intraOf(event);
  // Where the publication on the intra stands, for whoever follows it, the author and the people who run the events.
  const intraAccess = await getIntraAccess();
  const showIntra = intraPublicationEnabled() && (access.canCreate || intraAccess !== null);
  const intraRequest = showIntra ? await getIntraRequestOfEvent(event.id) : null;
  const intraReady = showIntra && intraReadiness(event, timeZone).ok;
  const repeatSummary = summaryInputOf(event, timeZone);
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

  const confirmationChannels = channelsFor(getConfig(), 'eventConfirmed');
  const noticeFor = (alreadyNotified: boolean): string | null => {
    const notice = confirmationNotice(confirmationChannels, alreadyNotified);
    return notice
      ? t(`detail.confirmDialog.${notice.key}`, { channels: chatNames(notice, locale) })
      : null;
  };
  const sentence = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ');
  const confirmationText = sentence(
    t('detail.confirmDialog.body'),
    noticeFor(event.confirmationNotifiedAt !== null),
  );

  return (
    <>
      <PageHeader title={shown.title} back={{ href: '/events', label: t('detail.back') }} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <EventNoticeAlert notice={readEventNotice(rawSearch.notice)} />
        <IntraNoticeAlert notice={readIntraNotice(rawSearch.notice)} />

        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={category} />
              <Badge variant={shown.status === 'CONFIRMED' ? 'secondary' : 'outline'}>
                {shown.status === 'PROPOSED' && <Clock data-icon="inline-start" aria-hidden />}
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
              variant="secondary"
              size="sm"
              render={<a href={`/api/events/${event.id}/ics?occ=${occurrence}`} download />}
            >
              <CalendarPlus data-icon="inline-start" />
              {t('detail.addToCalendar')}
            </Button>
            {mayEdit && (
              <Button
                variant="secondary"
                size="sm"
                render={
                  <Link
                    href={
                      isSeries && isValidator
                        ? { pathname: `/events/${event.id}/edit`, query: { occ: occurrence } }
                        : `/events/${event.id}/edit`
                    }
                  />
                }
              >
                <Pencil data-icon="inline-start" />
                {t('detail.edit')}
              </Button>
            )}
            {isProposerOnly && mayEdit && shown.status === 'DRAFT' && (
              <ActionButton
                variant="default"
                action={async () => {
                  'use server';
                  return setEventStatus(event.id, 'PROPOSED');
                }}
              >
                <Send data-icon="inline-start" />
                {t('detail.review.propose')}
              </ActionButton>
            )}
            {isProposerOnly && mayEdit && shown.status === 'PROPOSED' && (
              <ActionButton
                variant="secondary"
                action={async () => {
                  'use server';
                  return setEventStatus(event.id, 'DRAFT');
                }}
              >
                <Undo2 data-icon="inline-start" />
                {t('detail.review.withdraw')}
              </ActionButton>
            )}
            {isValidator && (
              <>
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
                {shown.status === 'PROPOSED' && (
                  // A proposal is answered, not toggled: approving publishes it, refusing says why (the whole event).
                  <ConfirmDialog
                    tone="destructive"
                    triggerVariant="destructive"
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
                      return refuseEvent(event.id, comment);
                    }}
                  >
                    <CircleX data-icon="inline-start" />
                    {t('detail.review.refuse')}
                  </ConfirmDialog>
                )}
                {shown.status !== 'CONFIRMED' ? (
                  // Confirming shows the event to every member and may notify them: it asks first,
                  // in the normal style (it is not destructive: going back to draft undoes it).
                  isSeries ? (
                    <ConfirmDialog
                      tone="default"
                      triggerVariant="default"
                      title={
                        shown.status === 'PROPOSED'
                          ? t('detail.review.approveDialog.title')
                          : t('detail.confirmDialog.title')
                      }
                      description={t('detail.confirmDialog.body')}
                      confirmLabel={
                        shown.status === 'PROPOSED'
                          ? t('detail.review.approveDialog.confirm')
                          : t('detail.confirmDialog.confirm')
                      }
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
                      {shown.status === 'PROPOSED'
                        ? t('detail.review.approve')
                        : t('detail.confirm')}
                    </ConfirmDialog>
                  ) : (
                    <ConfirmDialog
                      tone="default"
                      triggerVariant="default"
                      title={
                        shown.status === 'PROPOSED'
                          ? t('detail.review.approveDialog.title')
                          : t('detail.confirmDialog.title')
                      }
                      description={confirmationText}
                      confirmLabel={
                        shown.status === 'PROPOSED'
                          ? t('detail.review.approveDialog.confirm')
                          : t('detail.confirmDialog.confirm')
                      }
                      onConfirm={async () => {
                        'use server';
                        return setEventStatus(event.id, 'CONFIRMED');
                      }}
                    >
                      <CircleCheck data-icon="inline-start" />
                      {shown.status === 'PROPOSED'
                        ? t('detail.review.approve')
                        : t('detail.confirm')}
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

        {event.status === 'PROPOSED' && (
          <Alert>
            <Clock />
            <AlertTitle>{t('detail.review.proposedTitle')}</AlertTitle>
            <AlertDescription>
              {actor.login === event.authorLogin && !isValidator
                ? t('detail.review.proposedAuthor')
                : t('detail.review.proposedValidator', { author: event.authorLogin })}
              {event.proposedAt &&
                ` ${t('detail.review.proposedOn', { date: formatLongDate(event.proposedAt, locale, timeZone) })}`}
            </AlertDescription>
          </Alert>
        )}
        {event.status === 'DRAFT' && event.refusalComment && (
          <Alert variant="destructive">
            <CircleX />
            <AlertTitle>
              {t('detail.review.refusedTitle', {
                reviewer: event.refusedByLogin ?? '',
                date: event.refusedAt ? formatLongDate(event.refusedAt, locale, timeZone) : '',
              })}
            </AlertTitle>
            <AlertDescription>
              <p className="whitespace-pre-wrap">{event.refusalComment}</p>
              <p>
                {isValidator
                  ? t('detail.review.refusedHintValidator', { author: event.authorLogin })
                  : t('detail.review.refusedHintAuthor')}
              </p>
            </AlertDescription>
          </Alert>
        )}
        {lockedBecause === 'published' && (
          <Alert>
            <CircleCheck />
            <AlertTitle>{t('detail.review.lockedTitle')}</AlertTitle>
            <AlertDescription>{t('detail.review.lockedBody')}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent>
            <dl className="flex flex-col gap-4">
              <DetailRow icon={CalendarPlus} label={t('detail.when')}>
                <span className="first-letter:uppercase">
                  {formatDateTimeRange(shown.start, shown.end, locale, timeZone)}
                </span>
              </DetailRow>
              {repeatSummary && (
                <DetailRow icon={Repeat} label={t('detail.repeats')}>
                  {summarizeRepeat(repeatSummary, tRepeat, locale)}
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
                  <Markdown source={shown.description} />
                </DetailRow>
              )}
            </dl>
            <p className="text-small text-muted-foreground border-line mt-5 border-t pt-4">
              {t('detail.meta', { author: event.authorLogin, schoolYear: event.schoolYear })}
            </p>
          </CardContent>
        </Card>

        {showIntra && (
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.intra.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {intra ? (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {[
                    [t('form.intra.organizer'), intra.organizerLogin],
                    [t('form.intra.audience'), t(`form.intra.audiences.${intra.audience}`)],
                    [t('form.intra.maxPeople'), String(intra.maxPeople)],
                    [
                      t('form.intra.waitingList'),
                      intra.waitingList ? t('form.intra.yes') : t('form.intra.no'),
                    ],
                    [t('form.intra.kind'), intra.kind],
                    [
                      t('form.intra.unsubscribe'),
                      t('detail.intra.hours', { count: intra.unsubscribeHours }),
                    ],
                    [t('form.intra.keywords'), intra.keywords.join(', ')],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground text-small">{label}</dt>
                      <dd className="text-body break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-muted-foreground text-body">{t('detail.intra.missing')}</p>
              )}

              {intraRequest ? (
                <div className="border-line mt-5 flex flex-col gap-2 border-t pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-small font-semibold">{t('intra.publication.title')}</span>
                    <IntraStatusBadge
                      status={intraRequest.status}
                      label={t(`intra.status.${intraRequest.status}`)}
                    />
                  </div>
                  <p className="text-body break-words">
                    {intraRequest.status === 'PENDING' &&
                      t('intra.publication.pending', {
                        login: intraRequest.requestedByLogin,
                        date: formatLongDate(intraRequest.requestedAt, locale, timeZone),
                      })}
                    {isOnIntra(intraRequest.status) &&
                      t(
                        intraRequest.status === 'OUTDATED'
                          ? 'intra.publication.outdated'
                          : 'intra.publication.published',
                        {
                          login: intraRequest.answeredByLogin ?? '',
                          date: formatLongDate(
                            intraRequest.answeredAt ?? intraRequest.requestedAt,
                            locale,
                            timeZone,
                          ),
                        },
                      )}
                    {intraRequest.status === 'REFUSED' &&
                      t('intra.publication.refused', { login: intraRequest.answeredByLogin ?? '' })}
                    {isOnIntra(intraRequest.status) && intraRequest.intraUrl && (
                      <>
                        {' '}
                        <a
                          href={intraRequest.intraUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-ink underline underline-offset-3"
                        >
                          {t('intra.publication.open')}
                        </a>
                      </>
                    )}
                  </p>
                  {intraRequest.status === 'REFUSED' && intraRequest.refusalComment && (
                    <p className="text-muted-foreground text-body break-words whitespace-pre-wrap">
                      {intraRequest.refusalComment}
                    </p>
                  )}
                  {intraRequest.status === 'REFUSED' && intraAccess?.canRequest && intraReady && (
                    <div>
                      <ActionButton
                        action={async () => {
                          'use server';
                          return requestOnIntra(event.id, 'event');
                        }}
                      >
                        <Send data-icon="inline-start" />
                        {t('intra.publication.sendAgain')}
                      </ActionButton>
                    </div>
                  )}
                </div>
              ) : (
                intraReady &&
                intraAccess?.canRequest && (
                  <div className="border-line mt-5 flex flex-col gap-2 border-t pt-4">
                    <span className="text-small font-semibold">{t('intra.publication.title')}</span>
                    <p className="text-muted-foreground text-body">{t('intra.publication.none')}</p>
                    <div>
                      <ActionButton
                        action={async () => {
                          'use server';
                          return requestOnIntra(event.id, 'event');
                        }}
                      >
                        <Send data-icon="inline-start" />
                        {t('intra.publication.ask')}
                      </ActionButton>
                    </div>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        )}

        {isSeries && (
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.occurrences.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-muted-foreground text-body">{t('detail.occurrences.allPast')}</p>
              ) : (
                <ul>
                  {upcoming.slice(0, MAX_LISTED_OCCURRENCES).map((date) => {
                    const key = date.originalStart.getTime();
                    return (
                      <li
                        key={key}
                        className="border-line flex min-h-11 flex-wrap items-center justify-between gap-2 border-t py-2 first:border-t-0"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            href={{ pathname: `/events/${event.id}`, query: { occ: key } }}
                            className={cn(
                              'text-body rounded-xs hover:underline',
                              date.cancelled && 'text-muted-foreground line-through',
                              key === occurrence && 'font-bold',
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
                          {date.status !== 'CONFIRMED' && (
                            <Badge variant="outline">{t(`status.${date.status}`)}</Badge>
                          )}
                          {date.edited && (
                            <Badge variant="outline">{t('detail.occurrenceEdited')}</Badge>
                          )}
                        </div>
                        {isValidator && date.cancelled && (
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
                <p className="text-muted-foreground mt-3 text-small">
                  {t('detail.occurrences.truncated', {
                    count: upcoming.length - MAX_LISTED_OCCURRENCES,
                  })}
                </p>
              )}
              {pastCount > 0 && (
                <p className="text-muted-foreground mt-3 text-small">
                  {t('detail.occurrences.past', { count: pastCount })}
                </p>
              )}
              <div className="border-line mt-4 border-t pt-4">
                <Button
                  variant="secondary"
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

        {mayDelete && (
          <div>
            {isSeries && isValidator ? (
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
    </>
  );
}
