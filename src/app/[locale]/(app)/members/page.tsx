import { Check, UserCheck, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { getEffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { canManageMembers } from '@/lib/permissions';
import { redirect } from '@/i18n/navigation';
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
import { approveMember, rejectMember, removeMember, setModulePermission } from './actions';

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

export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user || !canManageMembers(session.user.role)) {
    redirect({ href: '/dashboard', locale });
  }

  const enabledModules = getConfig().modules.enabled;

  const [t, tRoles, users, grants] = await Promise.all([
    getTranslations('members'),
    getTranslations('roles'),
    prisma.user.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
    enabledModules.length > 0
      ? prisma.modulePermission.findMany({
          where: { module: { in: enabledModules } },
          select: { userId: true, module: true },
        })
      : Promise.resolve([]),
  ]);

  const grantedKeys = new Set(grants.map((grant) => `${grant.userId}:${grant.module}`));
  const moduleLabel = (key: string) =>
    t.has(`modules.names.${key}`) ? t(`modules.names.${key}`) : key;

  const pending = users.filter((user) => user.role === 'PENDING');
  const active = users.filter((user) => user.role !== 'PENDING');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

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
                          await approveMember(user.id);
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
                  {enabledModules.length > 0 && <TableHead>{t('columns.modules')}</TableHead>}
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
                      <Badge variant="secondary">{tRoles(user.role)}</Badge>
                    </TableCell>
                    {enabledModules.length > 0 && (
                      <TableCell>
                        {user.role === 'OWNER' ? (
                          <span className="text-muted-foreground text-sm">{t('modules.all')}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {enabledModules.map((moduleKey) => {
                              const granted = grantedKeys.has(`${user.id}:${moduleKey}`);
                              return (
                                <form
                                  key={moduleKey}
                                  action={async () => {
                                    'use server';
                                    await setModulePermission(user.id, moduleKey, !granted);
                                  }}
                                >
                                  <Button
                                    size="xs"
                                    type="submit"
                                    variant={granted ? 'default' : 'outline'}
                                    aria-pressed={granted}
                                    title={granted ? t('modules.revoke') : t('modules.grant')}
                                  >
                                    {granted && <Check data-icon="inline-start" />}
                                    {moduleLabel(moduleKey)}
                                  </Button>
                                </form>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {user.role !== 'OWNER' && (
                        <form
                          action={async () => {
                            'use server';
                            await removeMember(user.id);
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
