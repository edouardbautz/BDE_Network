import { CircleCheck, Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { Link, redirect } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/auth/session';
import { can, permissionDefinitions, ROLES_MANAGE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { ruleManageRole } from '@/lib/roles/guards';
import { actorOf, roleFacts } from '@/lib/roles/view';
import { describePermission } from '@/components/roles/permission-groups';
import { RoleActions } from '@/components/roles/role-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

function readSaved(value: string | string[] | undefined): 'created' | 'updated' | null {
  const saved = Array.isArray(value) ? value[0] : value;
  return saved === 'created' || saved === 'updated' ? saved : null;
}

export default async function RolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user || !can(session.user, ROLES_MANAGE)) {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const modules = getConfig().modules.enabled;
  const [t, tPermissions, roles, saved] = await Promise.all([
    getTranslations('roles'),
    getTranslations('permissions'),
    prisma.role.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    }),
    searchParams.then((query) => readSaved(query.saved)),
  ]);

  const actor = actorOf(session.user);
  const definitions = permissionDefinitions(modules);
  const labels = new Map(
    definitions.map((definition) => [
      definition.key,
      describePermission(tPermissions, definition).label,
    ]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('page.title')}</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">{t('page.description')}</p>
        </div>
        <Button render={<Link href="/roles/new" />}>
          <Plus data-icon="inline-start" />
          {t('page.create')}
        </Button>
      </div>

      {saved && (
        <Alert>
          <CircleCheck />
          <AlertDescription>{t(`saved.${saved}`)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('list.columns.name')}</TableHead>
                <TableHead>{t('list.columns.rights')}</TableHead>
                <TableHead>{t('list.columns.members')}</TableHead>
                <TableHead className="text-right">{t('list.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => {
                const refusal = ruleManageRole(actor, roleFacts(role, modules));
                const shown = role.permissions
                  .filter((key) => labels.has(key))
                  .map((key) => labels.get(key));
                return (
                  <TableRow key={role.id}>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{role.name}</span>
                        {role.isDefault && <Badge variant="secondary">{t('list.default')}</Badge>}
                      </div>
                      {role.description && (
                        <p className="text-muted-foreground mt-0.5 text-xs">{role.description}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs whitespace-normal">
                      {role.allPermissions ? (
                        <Badge>{t('list.allPermissions')}</Badge>
                      ) : shown.length > 0 ? (
                        shown.join(', ')
                      ) : (
                        t('list.noRights')
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t('list.membersCount', { count: role._count.users })}
                    </TableCell>
                    <TableCell className="text-right whitespace-normal">
                      <RoleActions
                        roleId={role.id}
                        roleName={role.name}
                        isDefault={role.isDefault}
                        memberCount={role._count.users}
                        manageable={refusal === null}
                        lockedReason={
                          refusal === 'ownRole' ? 'own' : refusal === null ? null : 'above'
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t('list.defaultNote')}</p>
    </div>
  );
}
