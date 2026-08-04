import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageMembers } from '@/lib/permissions';
import { redirect } from '@/i18n/navigation';
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

export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();

  if (!session?.user || !canManageMembers(session.user.role)) {
    redirect({ href: '/dashboard', locale });
  }

  const [t, tRoles, users] = await Promise.all([
    getTranslations('members'),
    getTranslations('roles'),
    prisma.user.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
  ]);

  const pending = users.filter((user) => user.role === 'PENDING');
  const active = users.filter((user) => user.role !== 'PENDING');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('pendingSection')}</CardTitle>
          </CardHeader>
          <CardContent>
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
                    <TableCell>{user.fullName}</TableCell>
                    <TableCell>{user.login}</TableCell>
                    <TableCell>{user.campus}</TableCell>
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
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('activeSection')}</CardTitle>
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
                    <TableCell>{user.fullName}</TableCell>
                    <TableCell>{user.login}</TableCell>
                    <TableCell>{user.campus}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tRoles(user.role)}</Badge>
                    </TableCell>
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
