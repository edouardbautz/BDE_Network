import { LayoutGrid } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { UpcomingEventsCard } from '@/components/events/upcoming-events-card';
import { OAuthRejectedAlert } from '@/components/settings/oauth-rejected-alert';
import { accountLabel } from '@/lib/account-label';
import { checkFortyTwoCredentials } from '@/lib/auth/oauth-check';
import { requireApprovedSession } from '@/lib/auth/require-session';
import { getEventsAccess } from '@/lib/events/access';
import { getCategories } from '@/lib/events/categories';
import { listUpcomingOccurrences } from '@/lib/events/queries';
import { can, canManageSettings, MEMBERS_MANAGE } from '@/lib/permissions';
import { Link } from '@/i18n/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { pageTitle } from '@/lib/page-title';
import { initialsOf } from '@/lib/initials';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('dashboard', 'title');

export default async function DashboardPage() {
  const session = await requireApprovedSession();
  const [t, tRoles] = await Promise.all([getTranslations('dashboard'), getTranslations('roles')]);

  const config = getConfig();
  // null when the events module is disabled — then nothing about it is queried or shown.
  const eventsAccess = await getEventsAccess();
  const upcomingEvents = eventsAccess
    ? await listUpcomingOccurrences({
        now: new Date(),
        limit: 5,
        includeDrafts: eventsAccess.canManage,
      })
    : [];

  // Only an owner can fix a 42 application that 42 refuses, and only an owner is told (and sent to the settings).
  const oauthRejected =
    canManageSettings(session.user) && (await checkFortyTwoCredentials()) === 'rejected';

  const displayName = session.user.name ?? session.user.login;
  const initials = initialsOf(displayName);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('welcome', { name: displayName })}</p>
      </div>

      {oauthRejected && <OAuthRejectedAlert withLink />}

      <Card className="max-w-sm">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <Avatar size="lg">
            {session.user.image ? <AvatarImage src={session.user.image} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle className="truncate text-base">{displayName}</CardTitle>
            <CardDescription className="truncate">
              {session.user.login} · {session.user.campus}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary">{accountLabel(session.user, tRoles)}</Badge>
        </CardContent>
      </Card>

      {eventsAccess && (
        <UpcomingEventsCard
          occurrences={upcomingEvents}
          categories={getCategories()}
          timeZone={config.bde.timezone}
          canManage={eventsAccess.canManage}
        />
      )}

      {config.modules.enabled.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
              <LayoutGrid className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t('empty.title')}</p>
              <p className="text-muted-foreground max-w-sm text-sm">{t('empty.description')}</p>
            </div>
            {can(session.user, MEMBERS_MANAGE) && (
              <Button size="sm" className="mt-1" render={<Link href="/members" />}>
                {t('empty.cta')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
