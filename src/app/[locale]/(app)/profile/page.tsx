import { CalendarSync } from 'lucide-react';
import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { CopyField } from '@/components/events/copy-field';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/auth/session';
import { isEventsModuleEnabled } from '@/lib/events/access';
import { ensureCalendarToken } from '@/lib/events/export';
import { regenerateMyCalendarToken } from './actions';

export const dynamic = 'force-dynamic';

/** Absolute URL of this instance: APP_URL when set, otherwise what the browser used. */
async function getOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

export default async function ProfilePage() {
  const session = await getEffectiveSession();
  if (!session?.user) {
    redirect({ href: '/', locale: await getLocale() });
    return null;
  }

  const [t, tRoles] = await Promise.all([getTranslations('profile'), getTranslations('roles')]);
  const user = session.user;
  const displayName = user.name ?? user.login;
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

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
        <CardHeader className="flex-row items-center gap-3 space-y-0">
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
            {tRoles(user.role)}
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

            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                {t('calendar.regenerate.summary')}
              </summary>
              <form
                className="mt-4 flex flex-col items-start gap-3"
                action={async () => {
                  'use server';
                  await regenerateMyCalendarToken();
                }}
              >
                <p className="text-muted-foreground text-sm">{t('calendar.regenerate.warning')}</p>
                <Button type="submit" variant="destructive" size="sm">
                  {t('calendar.regenerate.confirm')}
                </Button>
              </form>
            </details>

            <p className="text-muted-foreground text-xs">{t('calendar.privacy')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
