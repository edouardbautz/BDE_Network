import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EventForm } from '@/components/events/event-form';
import { redirect } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { listAssignableMembers } from '@/lib/events/queries';
import { cancelHrefFor, defaultEventTimes, requestedEventDay } from '@/lib/events/defaults';
import type { RawSearchParams } from '@/lib/events/search-params';
import { createEvent } from '../actions';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'form.createTitle');

/**
 * The form starts from 18:00–20:00 (BDE timezone), on the day of the "+" of the calendar (`?date=YYYY-MM-DD`, ignored
 * when it is not a real day) or, from the button, on tomorrow. Only the people who can create events get here: the
 * link of the calendar is hidden from the others, and this page and the action check it again.
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }
  if (!access.canManage) {
    // Members can read events but not create them: send them back to the list.
    redirect({ href: '/events', locale: await getLocale() });
  }

  const [t, raw] = await Promise.all([getTranslations('events'), searchParams]);
  const day = requestedEventDay(raw.date);
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
          ...defaultEventTimes(new Date(), timeZone, day),
          recurrence: 'NONE',
          recurrenceUntil: '',
          status: 'DRAFT',
          assigneeLogins: [],
        }}
        categories={categories.map(({ key, label }) => ({ key, label }))}
        members={await listAssignableMembers()}
        timeZone={timeZone}
        submitLabel={t('form.create')}
        cancelHref={cancelHrefFor(day)}
        isEditing={false}
      />
    </div>
  );
}
