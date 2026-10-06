import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EventForm } from '@/components/events/event-form';
import { redirect } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { listAssignableMembers } from '@/lib/events/queries';
import { addDays, formatLocalInput, fromLocalDateTime, toLocalDateTime } from '@/lib/events/time';
import { createEvent } from '../actions';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'form.createTitle');

/** Pre-fills tomorrow 18:00–20:00 (BDE timezone): a plausible starting point
 * that is quick to adjust, instead of an empty date picker. */
function defaultTimes(now: Date, timeZone: string) {
  const tomorrow = addDays(toLocalDateTime(now, timeZone), 1);
  const start = fromLocalDateTime({ ...tomorrow, hour: 18, minute: 0 }, timeZone);
  const end = fromLocalDateTime({ ...tomorrow, hour: 20, minute: 0 }, timeZone);
  return { startsAt: formatLocalInput(start, timeZone), endsAt: formatLocalInput(end, timeZone) };
}

export default async function NewEventPage() {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }
  if (!access.canManage) {
    // Members can read events but not create them: send them back to the list.
    redirect({ href: '/events', locale: await getLocale() });
  }

  const t = await getTranslations('events');
  const timeZone = getConfig().bde.timezone;
  const categories = getCategories();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('form.createTitle')}</h1>
      <EventForm
        action={createEvent}
        initial={{
          title: '',
          description: '',
          location: '',
          categoryKey: categories[0]?.key ?? '',
          ...defaultTimes(new Date(), timeZone),
          recurrence: 'NONE',
          recurrenceUntil: '',
          status: 'DRAFT',
          assigneeLogins: [],
        }}
        categories={categories.map(({ key, label }) => ({ key, label }))}
        members={await listAssignableMembers()}
        timeZone={timeZone}
        submitLabel={t('form.create')}
        cancelHref="/events"
        isEditing={false}
      />
    </div>
  );
}
