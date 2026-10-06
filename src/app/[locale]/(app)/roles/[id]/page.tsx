import { ArrowLeft, Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getConfig } from '@/config';
import { Link, redirect } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/auth/session';
import { can, permissionDefinitions, ROLES_MANAGE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { ruleManageRole } from '@/lib/roles/guards';
import { actorOf, roleFacts, visiblePermissions } from '@/lib/roles/view';
import { buildPermissionGroups } from '@/components/roles/permission-groups';
import { RoleForm } from '@/components/roles/role-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { updateRole } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const session = await getEffectiveSession();

  if (!session?.user || !can(session.user, ROLES_MANAGE)) {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const role = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) notFound();

  const modules = getConfig().modules.enabled;
  const [t, tPermissions] = await Promise.all([
    getTranslations('roles'),
    getTranslations('permissions'),
  ]);
  const actor = actorOf(session.user);
  const definitions = permissionDefinitions(modules);
  const groups = buildPermissionGroups(tPermissions, definitions, actor.set);
  const refusal = ruleManageRole(actor, roleFacts(role, modules));
  const granted = new Set(visiblePermissions(role, definitions));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col items-start gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/roles" />}>
          <ArrowLeft data-icon="inline-start" />
          {t('edit.back')}
        </Button>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('edit.title')} · {role.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {refusal === null ? t('edit.description') : null}{' '}
            {t('edit.members', { count: role._count.users })}
          </p>
        </div>
      </div>

      {refusal === null ? (
        <RoleForm
          action={updateRole.bind(null, role.id)}
          initial={{
            name: role.name,
            description: role.description ?? '',
            allPermissions: role.allPermissions,
            permissions: [...granted],
          }}
          groups={groups}
          canGrantAll={actor.set.all}
          submitLabel={t('edit.submit')}
          cancelHref="/roles"
        />
      ) : (
        <>
          <Alert>
            <Lock />
            <AlertDescription>
              {refusal === 'ownRole' ? t('edit.readOnlyOwn') : t('edit.readOnlyAbove')}
            </AlertDescription>
          </Alert>
          <Card>
            <CardContent className="flex flex-col gap-5">
              {role.allPermissions && (
                <Badge className="self-start">{t('list.allPermissions')}</Badge>
              )}
              {groups.map((group) => (
                <section key={group.section} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{group.title}</h2>
                  <ul className="flex flex-col gap-2">
                    {group.options.map((option) => {
                      const has = role.allPermissions || granted.has(option.key);
                      return (
                        <li key={option.key} className="flex items-start gap-3 text-sm">
                          <span
                            aria-hidden
                            className={cn(
                              'mt-1 size-2 shrink-0 rounded-full',
                              has ? 'bg-primary' : 'bg-muted-foreground/30',
                            )}
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className={has ? 'font-medium' : 'text-muted-foreground'}>
                              {option.label}
                              <span className="sr-only">
                                {has ? t('edit.has') : t('edit.hasNot')}
                              </span>
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {option.description}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
