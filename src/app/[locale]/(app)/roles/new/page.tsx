import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { redirect } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/auth/session';
import { can, permissionDefinitions, ROLES_MANAGE } from '@/lib/permissions';
import { actorOf } from '@/lib/roles/view';
import { buildPermissionGroups } from '@/components/roles/permission-groups';
import { RoleForm } from '@/components/roles/role-form';
import { createRole } from '../actions';
import { PageHeader } from '@/components/layout/page-header';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('roles', 'new.title');

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
    <>
      <PageHeader title={t('new.title')} back={{ href: '/roles', label: t('edit.back') }} />
      <p className="text-body text-muted-foreground -mt-2 mb-4 max-w-[68ch] sm:-mt-3 sm:mb-5">
        {t('new.description')}
      </p>
      <div className="flex max-w-3xl flex-col gap-3 sm:gap-4">
        <RoleForm
          action={createRole}
          initial={{ name: '', description: '', allPermissions: false, permissions: [] }}
          groups={groups}
          canGrantAll={actor.set.all}
          submitLabel={t('new.submit')}
          cancelHref="/roles"
        />
      </div>
    </>
  );
}
