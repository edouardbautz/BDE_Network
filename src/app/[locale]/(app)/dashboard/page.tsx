import {
  CalendarDays,
  ClipboardCheck,
  LayoutGrid,
  Plus,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { AccountCard } from '@/components/dashboard/account-card';
import { NextEventCard } from '@/components/dashboard/next-event-card';
import { Shortcuts, type Shortcut } from '@/components/dashboard/shortcuts';
import { UpcomingList } from '@/components/dashboard/upcoming-list';
import { EmptyState } from '@/components/galets/empty-state';
import { cardSurface, pillButton } from '@/components/galets/styles';
import { PageHeader } from '@/components/layout/page-header';
import { OAuthRejectedAlert } from '@/components/settings/oauth-rejected-alert';
import { UpdateBanner } from '@/components/updates/update-banner';
import { accountLabel } from '@/lib/account-label';
import { checkFortyTwoCredentials } from '@/lib/auth/oauth-check';
import { requireApprovedSession } from '@/lib/auth/require-session';
import { canValidateEvents, getEventsAccess, getIntraAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { formatShortDate } from '@/lib/events/format';
import { countIntraToDo } from '@/lib/events/intra-queries';
import { countProposals, listUpcomingOccurrences } from '@/lib/events/queries';
import { draftVisibility } from '@/lib/events/review';
import { can, canManageSettings, MEMBERS_MANAGE } from '@/lib/permissions';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/page-title';
import { initialsOf } from '@/lib/initials';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('dashboard', 'title');

export default async function DashboardPage() {
  const session = await requireApprovedSession();
  const [t, tNav, tEvents, tRoles, locale] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('nav'),
    getTranslations('events'),
    getTranslations('roles'),
    getLocale(),
  ]);

  const config = getConfig();
  const timeZone = config.bde.timezone;
  const now = new Date();
  // null when the events module is disabled — then nothing about it is queried or shown.
  const eventsAccess = await getEventsAccess();
  const upcoming = eventsAccess
    ? await listUpcomingOccurrences({
        now,
        limit: 5,
        ...draftVisibility(eventsAccess),
      })
    : [];
  const [next, ...others] = upcoming;

  // Only an owner can fix a 42 application that 42 refuses, and only an owner is told (and sent to the settings).
  const oauthRejected =
    canManageSettings(session.user) && (await checkFortyTwoCredentials()) === 'rejected';

  const displayName = session.user.name ?? session.user.login;
  const firstName = displayName.split(/\s+/)[0] ?? displayName;

  const waiting = canValidateEvents(session.user) ? await countProposals() : 0;
  const shortcuts: Shortcut[] = [];
  if (eventsAccess) {
    shortcuts.push({ href: '/events', label: tNav('rail.events'), icon: CalendarDays });
    if (canValidateEvents(session.user)) {
      shortcuts.push({
        href: '/events/review',
        label: tNav('rail.eventsReview'),
        icon: ClipboardCheck,
        count: waiting,
        countLabel: tNav('eventsReviewCount', { count: waiting }),
      });
    }
  }
  // The staff's page needs no access to the calendar: it is offered on its own.
  const intraAccess = await getIntraAccess();
  if (intraAccess) {
    const toDo = intraAccess.canPublish ? await countIntraToDo() : 0;
    shortcuts.push({
      href: '/events/intra',
      label: tNav('rail.eventsIntra'),
      icon: Send,
      count: toDo,
      countLabel: tNav('eventsIntraCount', { count: toDo }),
    });
  }
  if (can(session.user, MEMBERS_MANAGE)) {
    shortcuts.push({ href: '/members', label: tNav('rail.members'), icon: Users });
  }
  if (canManageSettings(session.user)) {
    shortcuts.push({ href: '/settings', label: tNav('rail.settings'), icon: Settings });
  }

  return (
    <>
      <PageHeader
        eyebrow={formatShortDate(now, locale, timeZone)}
        title={t('greeting', { name: firstName })}
        actions={
          eventsAccess?.canCreate ? (
            <Link href="/events/new" className={pillButton({ size: 'lg' })}>
              <Plus aria-hidden="true" className="size-5" />
              {tEvents('new')}
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:gap-4">
        {oauthRejected && <OAuthRejectedAlert withLink />}

        {/* Only an owner can update the platform, and only an owner is told (the route says 404 to anybody else). */}
        {canManageSettings(session.user) && <UpdateBanner enabled={config.updates.check} />}

        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
          {/* The wide column: the one accent moment, then what comes next. */}
          <div className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:col-span-8">
            {next && <NextEventCard occurrence={next} now={now} timeZone={timeZone} />}
            {eventsAccess && (
              <UpcomingList
                occurrences={next ? others : []}
                categories={getCategories()}
                timeZone={timeZone}
                canCreate={eventsAccess.canCreate}
              />
            )}
          </div>

          {/* The narrow column: who is signed in comes first on a computer, the shortcuts first on a phone. */}
          <div className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:col-span-4">
            <Shortcuts title={t('shortcuts.title')} items={shortcuts} />
            <AccountCard
              name={displayName}
              initials={initialsOf(displayName)}
              image={session.user.image ?? null}
              detail={`${session.user.login} · ${session.user.campus}`}
              roleLabel={accountLabel(session.user, tRoles)}
              className="lg:-order-1"
            />
          </div>

          {config.modules.enabled.length === 0 && (
            <section className={cn(cardSurface, 'lg:col-span-12')}>
              <EmptyState
                icon={LayoutGrid}
                title={t('empty.title')}
                description={t('empty.description')}
                action={
                  can(session.user, MEMBERS_MANAGE) ? (
                    <Link
                      href="/members"
                      className={pillButton({ variant: 'secondary', size: 'md' })}
                    >
                      {t('empty.cta')}
                    </Link>
                  ) : undefined
                }
              />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
