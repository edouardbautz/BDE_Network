import { CalendarSync } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyField } from '@/components/events/copy-field';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountLabel } from '@/lib/account-label';
import { requireApprovedSession } from '@/lib/auth/require-session';
import { isEventsModuleEnabled } from '@/lib/events/access';
import { ensureCalendarToken } from '@/lib/events/export';
import { getOrigin } from '@/lib/events/origin';
import { regenerateMyCalendarToken } from './actions';
import { pageTitle } from '@/lib/page-title';
import { initialsOf } from '@/lib/initials';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('profile', 'title');

export default async function ProfilePage() {
  const session = await requireApprovedSession();

  const [t, tRoles] = await Promise.all([getTranslations('profile'), getTranslations('roles')]);
  const user = session.user;
  const displayName = user.name ?? user.login;
  const initials = initialsOf(displayName);

  const showCalendar = isEventsModuleEnabled();
  const feedUrl = showCalendar
    ? `${await getOrigin()}/api/calendar/${await ensureCalendarToken(user.id)}.ics`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <Card className="max-w-xl">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <Avatar size="lg">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle className="truncate text-base">{displayName}</CardTitle>
            <CardDescription className="truncate">
              {user.login} · {user.campus}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="ml-auto">
            {accountLabel(user, tRoles)}
          </Badge>
        </CardHeader>
      </Card>

      {feedUrl && (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarSync className="text-muted-foreground size-4" />
              {t('calendar.title')}
            </CardTitle>
            <CardDescription>{t('calendar.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <CopyField id="calendar-feed-url" value={feedUrl} label={t('calendar.linkLabel')} />

            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              <li>{t('calendar.google')}</li>
              <li>{t('calendar.outlook')}</li>
              <li>{t('calendar.apple')}</li>
            </ul>

            <div>
              <ConfirmDialog
                title={t('calendar.regenerate.title')}
                description={t('calendar.regenerate.warning')}
                confirmLabel={t('calendar.regenerate.confirm')}
                onConfirm={async () => {
                  'use server';
                  await regenerateMyCalendarToken();
                }}
              >
                {t('calendar.regenerate.summary')}
              </ConfirmDialog>
            </div>

            <p className="text-muted-foreground text-xs">{t('calendar.privacy')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
