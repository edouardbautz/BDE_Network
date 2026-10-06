import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EventForm } from '@/components/events/event-form';
import { redirect } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { getVisibleEvent, listAssignableMembers } from '@/lib/events/queries';
import { formatLocalDateInput, formatLocalInput } from '@/lib/events/time';
import { updateEvent } from '../../actions';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'form.editTitle');

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }

  const { id } = await params;
  if (!access.canManage) {
    redirect({ href: `/events/${id}`, locale: await getLocale() });
  }

  const event = await getVisibleEvent(id, true);
  if (!event) {
    notFound();
  }

  const t = await getTranslations('events');
  const timeZone = getConfig().bde.timezone;
  const categories = getCategories();
  // A category removed from the config must stay selectable, or saving would reset it.
  const knownCategory = categories.some((category) => category.key === event.categoryKey);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('form.editTitle')}</h1>
      <EventForm
        action={updateEvent.bind(null, event.id)}
        initial={{
          title: event.title,
          description: event.description ?? '',
          location: event.location ?? '',
          categoryKey: event.categoryKey,
          startsAt: formatLocalInput(event.startsAt, timeZone),
          endsAt: formatLocalInput(event.endsAt, timeZone),
          recurrence: event.recurrence,
          recurrenceUntil: event.recurrenceUntil
            ? formatLocalDateInput(event.recurrenceUntil, timeZone)
            : '',
          status: event.status,
          assigneeLogins: event.assignees.map((assignee) => assignee.login),
        }}
        categories={[
          ...categories.map(({ key, label }) => ({ key, label })),
          ...(knownCategory ? [] : [{ key: event.categoryKey, label: event.categoryKey }]),
        ]}
        members={await listAssignableMembers()}
        timeZone={timeZone}
        submitLabel={t('form.save')}
        cancelHref={`/events/${event.id}`}
        isEditing
      />
    </div>
  );
}
