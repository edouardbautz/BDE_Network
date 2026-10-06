import { CalendarSync, UserCheck, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { getEffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { can, MEMBERS_MANAGE } from '@/lib/permissions';
import { accountLabel } from '@/lib/account-label';
import { Link, redirect } from '@/i18n/navigation';
import { getBdeFeedToken } from '@/lib/events/export';
import { regenerateSharedCalendar } from '../events/shared-calendar/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { approveMember, rejectMember, removeMember } from './actions';

export const dynamic = 'force-dynamic';

function initialsOf(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function MemberIdentity({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar size="sm">
        {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <span className="font-medium">{name}</span>
    </div>
  );
}

/** Logins are `[a-z0-9-]`: anything else in the URL is ignored, never echoed. */
function readRemovedLogin(value: string | string[] | undefined): string | null {
  const login = Array.isArray(value) ? value[0] : value;
  return login && /^[a-z0-9-]{1,64}$/i.test(login) ? login : null;
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ removed?: string | string[] }>;
}) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user || !can(session.user, MEMBERS_MANAGE)) {
    redirect({ href: '/dashboard', locale });
  }

  const enabledModules = getConfig().modules.enabled;

  // After a removal: if a BDE-wide calendar link is active, the departed member may
  // still have it (it is a shared secret), so offer to replace it.
  const removedLogin = readRemovedLogin((await searchParams).removed);
  const offerFeedRegeneration =
    removedLogin !== null &&
    enabledModules.includes('events') &&
    (await getBdeFeedToken()) !== null;

  const [t, tRoles, users, defaultRole] = await Promise.all([
    getTranslations('members'),
    getTranslations('roles'),
    prisma.user.findMany({
      include: { role: { select: { name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.role.findFirst({ where: { isDefault: true }, select: { id: true } }),
  ]);

  const pending = users.filter((user) => user.status === 'PENDING');
  const active = users.filter((user) => user.status !== 'PENDING');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {offerFeedRegeneration && (
        <Alert>
          <CalendarSync />
          <AlertTitle>{t('feedRemoval.title', { member: removedLogin })}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{t('feedRemoval.description')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <form
                action={async () => {
                  'use server';
                  await regenerateSharedCalendar(removedLogin);
                }}
              >
                <Button size="sm" type="submit">
                  {t('feedRemoval.regenerate')}
                </Button>
              </form>
              <Button variant="ghost" size="sm" render={<Link href="/members" />}>
                {t('feedRemoval.later')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCheck className="text-muted-foreground size-4" />
            {t('pendingSection')}
          </CardTitle>
          {pending.length > 0 && (
            <Badge variant="secondary">{t('pendingCount', { count: pending.length })}</Badge>
          )}
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('pendingEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.login')}</TableHead>
                  <TableHead>{t('columns.campus')}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <MemberIdentity name={user.fullName} photoUrl={user.photoUrl} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.login}</TableCell>
                    <TableCell className="text-muted-foreground">{user.campus}</TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <form
                        action={async () => {
                          'use server';
                          if (defaultRole) await approveMember(user.id, defaultRole.id);
                        }}
                      >
                        <Button size="sm" type="submit">
                          {t('approve')}
                        </Button>
                      </form>
                      <form
                        action={async () => {
                          'use server';
                          await rejectMember(user.id);
                        }}
                      >
                        <Button size="sm" variant="outline" type="submit">
                          {t('reject')}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="text-muted-foreground size-4" />
            {t('activeSection')}
          </CardTitle>
          {active.length > 0 && <Badge variant="secondary">{active.length}</Badge>}
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.login')}</TableHead>
                  <TableHead>{t('columns.campus')}</TableHead>
                  <TableHead>{t('columns.role')}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <MemberIdentity name={user.fullName} photoUrl={user.photoUrl} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.login}</TableCell>
                    <TableCell className="text-muted-foreground">{user.campus}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {accountLabel(
                          { status: user.status, roleName: user.role?.name ?? null },
                          tRoles,
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {user.status !== 'OWNER' && (
                        <form
                          action={async () => {
                            'use server';
                            await removeMember(user.id);
                            redirect({
                              href: { pathname: '/members', query: { removed: user.login } },
                              locale,
                            });
                          }}
                        >
                          <Button size="sm" variant="destructive" type="submit">
                            {t('remove')}
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
