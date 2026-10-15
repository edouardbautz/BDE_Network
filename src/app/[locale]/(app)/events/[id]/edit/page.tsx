import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EventForm } from '@/components/events/event-form';
import { redirect } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { formatLongDate } from '@/lib/events/format';
import { getVisibleEvent, listAssignableMembers } from '@/lib/events/queries';
import { resolveOccurrences, scopeFacts } from '@/lib/events/series';
import { formatLocalDateInput, formatLocalInput } from '@/lib/events/time';
import { updateEvent } from '../../actions';
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
  if (!access.canManage) {
    redirect({ href: `/events/${id}`, locale: await getLocale() });
  }

  const event = await getVisibleEvent(id, true);
  if (!event) {
    notFound();
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
  const isSeries = event.recurrence !== 'NONE';
  const facts = scopeFacts(dates, date.originalStart);
  const back = isSeries
    ? { pathname: `/events/${event.id}`, query: { occ: date.originalStart.getTime() } }
    : `/events/${event.id}`;

  // A category removed from the config must stay selectable, or saving would reset it.
  const knownCategory = categories.some((category) => category.key === date.categoryKey);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('form.editTitle')}</h1>
      {isSeries && (
        <p className="text-muted-foreground text-sm first-letter:uppercase">
          {formatLongDate(date.start, locale, timeZone)}
        </p>
      )}
      <EventForm
        action={updateEvent.bind(null, event.id)}
        initial={{
          title: date.title,
          description: date.description ?? '',
          location: date.location ?? '',
          categoryKey: date.categoryKey,
          startsAt: formatLocalInput(date.start, timeZone),
          endsAt: formatLocalInput(date.end, timeZone),
          recurrence: event.recurrence,
          recurrenceUntil: event.recurrenceUntil
            ? formatLocalDateInput(event.recurrenceUntil, timeZone)
            : '',
          status: date.status,
          assigneeLogins: date.assignees.map((assignee) => assignee.login),
        }}
        categories={[
          ...categories.map(({ key, label }) => ({ key, label })),
          ...(knownCategory ? [] : [{ key: date.categoryKey, label: date.categoryKey }]),
        ]}
        members={await listAssignableMembers()}
        timeZone={timeZone}
        submitLabel={t('form.save')}
        cancelHref={back}
        isEditing
        series={
          isSeries
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
    </div>
  );
}
