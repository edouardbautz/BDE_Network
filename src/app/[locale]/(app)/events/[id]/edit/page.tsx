import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EventForm } from '@/components/events/event-form';
import { redirect } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { rawIntraOf } from '@/lib/events/intra';
import { intraPublicationEnabled } from '@/lib/events/intra-config';
import { formatLongDate } from '@/lib/events/format';
import { getVisibleEvent, listAssignableMembers } from '@/lib/events/queries';
import { canEditEvent, draftVisibility, reviewActorOf, statusChoices } from '@/lib/events/review';
import { resolveOccurrences, scopeFacts } from '@/lib/events/series';
import { cutRule, isRepeating, readRepeatRule } from '@/lib/events/repeat';
import { allOccurrences } from '@/lib/events/recurrence';
import { rawRepeatOf } from '@/lib/events/repeat-input';
import { formatLocalDateInput, formatLocalInput, toLocalDateTime } from '@/lib/events/time';
import { updateEvent } from '../../actions';
import { PageHeader } from '@/components/layout/page-header';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'form.editTitle');

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occ?: string | string[] }>;
}) {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }

  const [{ id }, rawSearch] = await Promise.all([params, searchParams]);
  if (!access.canCreate) {
    // A member who only reads edits nothing: no need to look at the event.
    redirect({ href: `/events/${id}`, locale: await getLocale() });
  }
  const event = await getVisibleEvent(id, draftVisibility(access));
  if (!event) {
    notFound();
  }
  // Whoever may not edit this event (a member, or a proposer looking at a published event or another's) is
  // sent to its page, which says why.
  const actor = reviewActorOf(access);
  const reviewed = {
    status: event.status,
    authorLogin: event.authorLogin,
    dateStatuses: event.occurrences.map((own) => own.status),
  };
  if (!canEditEvent(actor, reviewed)) {
    redirect({ href: `/events/${id}`, locale: await getLocale() });
  }

  const [t, locale] = await Promise.all([getTranslations('events'), getLocale()]);
  const timeZone = getConfig().bde.timezone;
  const categories = getCategories();

  // The form shows the date it was opened from, with what that date is (its own values on top of the series').
  const dates = resolveOccurrences(event, timeZone);
  const requested = Array.isArray(rawSearch.occ) ? rawSearch.occ[0] : rawSearch.occ;
  const date = dates.find((d) => String(d.originalStart.getTime()) === requested) ?? dates[0];
  if (!date) {
    notFound();
  }
  const isSeries = isRepeating(event);
  // A proposer edits the event as a whole, never one date of a series: no choice of scope to ask.
  const askScope = isSeries && actor.canValidate;
  const facts = scopeFacts(dates, date.originalStart);
  // What the form says about the repetition is what the series does from this date on ("this one and the following"):
  // from a later date a series that ends after N dates says how many are left, not N again.
  const rule = readRepeatRule(event.repeat);
  const index = allOccurrences(event, timeZone).findIndex(
    (occurrence) => occurrence.start.getTime() === date.originalStart.getTime(),
  );
  const first = toLocalDateTime(date.originalStart, timeZone);
  const rest =
    rule && index > 0 ? cutRule(rule, toLocalDateTime(event.startsAt, timeZone), index).tail : rule;
  const back = isSeries
    ? { pathname: `/events/${event.id}`, query: { occ: date.originalStart.getTime() } }
    : `/events/${event.id}`;

  // A category removed from the config must stay selectable, or saving would reset it.
  const knownCategory = categories.some((category) => category.key === date.categoryKey);

  return (
    <>
      <PageHeader
        title={t('form.editTitle')}
        eyebrow={askScope ? formatLongDate(date.start, locale, timeZone) : undefined}
      />
      <EventForm
        action={updateEvent.bind(null, event.id)}
        initial={{
          title: date.title,
          description: date.description ?? '',
          location: date.location ?? '',
          categoryKey: date.categoryKey,
          startsAt: formatLocalInput(date.start, timeZone),
          endsAt: formatLocalInput(date.end, timeZone),
          ...rawRepeatOf(
            rest,
            first,
            event.recurrenceUntil ? formatLocalDateInput(event.recurrenceUntil, timeZone) : '',
          ),
          status: date.status,
          assigneeLogins: date.assignees.map((assignee) => assignee.login),
          ...rawIntraOf(event, access.session.user.login),
        }}
        intra={intraPublicationEnabled()}
        categories={[
          ...categories.map(({ key, label }) => ({ key, label })),
          ...(knownCategory ? [] : [{ key: date.categoryKey, label: date.categoryKey }]),
        ]}
        members={await listAssignableMembers()}
        timeZone={timeZone}
        submitLabel={t('form.save')}
        cancelHref={back}
        isEditing
        statusChoices={statusChoices(actor, date.status)}
        series={
          askScope
            ? {
                occurrence: date.originalStart.getTime(),
                isFirst: facts.isFirst,
                total: facts.total,
                following: facts.following,
                edited: facts.edited,
              }
            : undefined
        }
      />
    </>
  );
}
