import { Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getConfig } from '@/config';
import { redirect } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/auth/session';
import { can, permissionDefinitions, ROLES_MANAGE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { ruleManageRole } from '@/lib/roles/guards';
import { actorOf, roleFacts, visiblePermissions } from '@/lib/roles/view';
import { buildPermissionGroups } from '@/components/roles/permission-groups';
import { RoleForm } from '@/components/roles/role-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { updateRole } from '../actions';
import { PageHeader } from '@/components/layout/page-header';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('roles', 'edit.title');

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
    <>
      <PageHeader
        title={`${t('edit.title')} · ${role.name}`}
        back={{ href: '/roles', label: t('edit.back') }}
      />
      <p className="text-body text-muted-foreground -mt-2 mb-4 max-w-[68ch] sm:-mt-3 sm:mb-5">
        {refusal === null ? t('edit.description') : null}{' '}
        {t('edit.members', { count: role._count.users })}
      </p>
      <div className="flex max-w-3xl flex-col gap-3 sm:gap-4">
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
                    <h2 className="text-body-strong">{group.title}</h2>
                    <ul className="flex flex-col gap-2">
                      {group.options.map((option) => {
                        const has = role.allPermissions || granted.has(option.key);
                        return (
                          <li key={option.key} className="flex items-start gap-3 text-body">
                            <span
                              aria-hidden
                              className={cn(
                                'mt-1.5 size-2 shrink-0 rounded-pill',
                                has ? 'bg-ink' : 'bg-disabled',
                              )}
                            />
                            <span className="flex flex-col gap-0.5">
                              <span className={has ? 'font-semibold' : 'text-muted-foreground'}>
                                {option.label}
                                <span className="sr-only">
                                  {has ? t('edit.has') : t('edit.hasNot')}
                                </span>
                              </span>
                              <span className="text-muted-foreground text-small">
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
    </>
  );
}
