import { CalendarSync, UserCheck, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { getEffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { can, holdsAllOf, MEMBERS_MANAGE, ROLES_MANAGE } from '@/lib/permissions';
import { accountLabel } from '@/lib/account-label';
import { initialsOf } from '@/lib/initials';
import { Link, redirect } from '@/i18n/navigation';
import { getBdeFeedToken } from '@/lib/events/export';
import { actorOf, roleFacts } from '@/lib/roles/view';
import { regenerateSharedCalendar } from '../events/shared-calendar/actions';
import {
  MemberRoleSelect,
  PendingMemberActions,
  RemoveMemberButton,
  type MemberLock,
  type RoleChoice,
} from '@/components/members/member-controls';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pageTitle } from '@/lib/page-title';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('members', 'title');

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
    return null;
  }

  const enabledModules = getConfig().modules.enabled;

  // After a removal: if a BDE-wide calendar link is active, the departed member may
  // still have it (it is a shared secret), so offer to replace it.
  const removedLogin = readRemovedLogin((await searchParams).removed);
  const offerFeedRegeneration =
    removedLogin !== null &&
    enabledModules.includes('events') &&
    (await getBdeFeedToken()) !== null;

  const [t, tRoles, users, roles] = await Promise.all([
    getTranslations('members'),
    getTranslations('roles'),
    prisma.user.findMany({
      include: { role: { select: { id: true, name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.role.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
  ]);

  const actor = actorOf(session.user);

  // What the person looking can hand out: only roles whose every right they hold. The server
  // checks again (src/lib/roles/guards.ts); this only keeps the menus honest.
  const grantableIds = new Set(
    roles
      .filter((role) => holdsAllOf(actor.set, roleFacts(role, enabledModules).set))
      .map((role) => role.id),
  );
  const choices: RoleChoice[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    grantable: grantableIds.has(role.id),
  }));
  const offeredFirst =
    roles.find((role) => role.isDefault && grantableIds.has(role.id)) ??
    roles.find((role) => grantableIds.has(role.id)) ??
    roles[0];

  const lockOf = (user: (typeof users)[number]): MemberLock => {
    if (user.id === actor.id) return 'self';
    if (user.status === 'MEMBER' && (!user.role || !grantableIds.has(user.role.id))) return 'above';
    return null;
  };

  const pending = users.filter((user) => user.status === 'PENDING');
  const active = users.filter((user) => user.status !== 'PENDING');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {can(session.user, ROLES_MANAGE) && (
          <Button variant="outline" size="sm" render={<Link href="/roles" />}>
            {t('manageRoles')}
          </Button>
        )}
      </div>

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
                  <TableHead className="text-right">{t('columns.actions')}</TableHead>
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
                    <TableCell className="whitespace-normal">
                      {offeredFirst && (
                        <PendingMemberActions
                          userId={user.id}
                          memberName={user.fullName}
                          roles={choices}
                          initialRoleId={offeredFirst.id}
                        />
                      )}
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
                  <TableHead className="text-right">{t('columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((user) => {
                  const lock = lockOf(user);
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <MemberIdentity name={user.fullName} photoUrl={user.photoUrl} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.login}</TableCell>
                      <TableCell className="text-muted-foreground">{user.campus}</TableCell>
                      <TableCell className="whitespace-normal">
                        {user.status === 'MEMBER' && user.role ? (
                          <MemberRoleSelect
                            userId={user.id}
                            memberName={user.fullName}
                            currentRoleId={user.role.id}
                            roles={choices}
                            lock={lock}
                          />
                        ) : (
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="self-start">
                              {accountLabel({ status: user.status, roleName: null }, tRoles)}
                            </Badge>
                            <span className="text-muted-foreground text-xs">{t('ownerNote')}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {user.status === 'MEMBER' && lock === null && (
                          <RemoveMemberButton
                            userId={user.id}
                            login={user.login}
                            memberName={user.fullName}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
