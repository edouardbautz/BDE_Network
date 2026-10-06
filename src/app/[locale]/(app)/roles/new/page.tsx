import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { Link, redirect } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/auth/session';
import { can, permissionDefinitions, ROLES_MANAGE } from '@/lib/permissions';
import { actorOf } from '@/lib/roles/view';
import { buildPermissionGroups } from '@/components/roles/permission-groups';
import { RoleForm } from '@/components/roles/role-form';
import { Button } from '@/components/ui/button';
import { createRole } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewRolePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user || !can(session.user, ROLES_MANAGE)) {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const [t, tPermissions] = await Promise.all([
    getTranslations('roles'),
    getTranslations('permissions'),
  ]);
  const actor = actorOf(session.user);
  const groups = buildPermissionGroups(
    tPermissions,
    permissionDefinitions(getConfig().modules.enabled),
    actor.set,
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col items-start gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/roles" />}>
          <ArrowLeft data-icon="inline-start" />
          {t('edit.back')}
        </Button>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('new.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('new.description')}</p>
        </div>
      </div>

      <RoleForm
        action={createRole}
        initial={{ name: '', description: '', allPermissions: false, permissions: [] }}
        groups={groups}
        canGrantAll={actor.set.all}
        submitLabel={t('new.submit')}
        cancelHref="/roles"
      />
    </div>
  );
}
