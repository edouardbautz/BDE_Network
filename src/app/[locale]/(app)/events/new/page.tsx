import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { EventForm } from '@/components/events/event-form';
import { redirect } from '@/i18n/navigation';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { listAssignableMembers } from '@/lib/events/queries';
import { NO_REPEAT } from '@/lib/events/repeat-input';
import { reviewActorOf, statusChoices } from '@/lib/events/review';
import { cancelHrefFor, defaultEventTimes, requestedEventDay } from '@/lib/events/defaults';
import type { RawSearchParams } from '@/lib/events/search-params';
import { createEvent } from '../actions';
import { PageHeader } from '@/components/layout/page-header';
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
  if (!access.canCreate) {
    // Members can read events but not create them: send them back to the list.
    redirect({ href: '/events', locale: await getLocale() });
  }

  const [t, raw] = await Promise.all([getTranslations('events'), searchParams]);
  const day = requestedEventDay(raw.date);
  const timeZone = getConfig().bde.timezone;
  const categories = getCategories();
  // A validator starts a draft; somebody who can only propose starts a proposal, which is what they come to do.
  const choices = statusChoices(reviewActorOf(access), null);
  const status = access.canValidate ? 'DRAFT' : 'PROPOSED';

  return (
    <>
      <PageHeader title={t('form.createTitle')} />
      <EventForm
        action={createEvent}
        initial={{
          title: '',
          description: '',
          location: '',
          categoryKey: categories[0]?.key ?? '',
          ...defaultEventTimes(new Date(), timeZone, day),
          ...NO_REPEAT,
          status,
          assigneeLogins: [],
        }}
        statusChoices={choices}
        categories={categories.map(({ key, label }) => ({ key, label }))}
        members={await listAssignableMembers()}
        timeZone={timeZone}
        submitLabel={t('form.create')}
        cancelHref={cancelHrefFor(day)}
        isEditing={false}
      />
    </>
  );
}
