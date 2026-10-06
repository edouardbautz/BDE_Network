'use client';

import { useTransition } from 'react';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { deleteRole, setDefaultRole } from '@/app/[locale]/(app)/roles/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/roles/errors';

interface RoleActionsProps {
  roleId: string;
  roleName: string;
  isDefault: boolean;
  memberCount: number;
  /** The person looking may edit, delete and flag this role (see lib/roles/guards.ts). */
  manageable: boolean;
  /** Why not, when they may not: their own role, or a role with rights they lack. */
  lockedReason: 'own' | 'above' | null;
}

/** The buttons of one row of the roles list. Every refusal the server gives is shown as it is. */
export function RoleActions({
  roleId,
  roleName,
  isDefault,
  memberCount,
  manageable,
  lockedReason,
}: RoleActionsProps) {
  const t = useTranslations('roles');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (work: () => Promise<ActionResult>, success: string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(success);
      else {
        toast.error(t(`errors.${result.error}`));
        // Often the list was out of date (role already deleted, members moved): redraw it.
        router.refresh();
      }
    });

  if (!manageable) {
    return (
      <span className="text-muted-foreground text-xs">
        {lockedReason === 'own' ? t('list.lockedOwn') : t('list.lockedAbove')}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        render={<Link href={`/roles/${roleId}`} />}
        aria-label={t('list.editLabel', { name: roleName })}
      >
        <Pencil data-icon="inline-start" />
        {t('list.edit')}
      </Button>

      {!isDefault && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(() => setDefaultRole(roleId), t('list.defaultSet', { name: roleName }))
          }
          aria-label={t('list.setDefaultLabel', { name: roleName })}
        >
          <Star data-icon="inline-start" />
          {t('list.setDefault')}
        </Button>
      )}

      {!isDefault &&
        (memberCount > 0 ? (
          // Not a confirmation: there is nothing to confirm, the role cannot go while it is held.
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            aria-disabled
            onClick={() => toast(t('list.deleteInUse', { count: memberCount }))}
          >
            <Trash2 data-icon="inline-start" />
            {t('list.delete')}
            <span className="sr-only">{roleName}</span>
          </Button>
        ) : (
          <ConfirmDialog
            triggerVariant="ghost"
            triggerClassName="text-destructive"
            title={t('list.deleteTitle', { name: roleName })}
            description={t('list.deleteWarning', { name: roleName })}
            confirmLabel={t('list.deleteConfirm')}
            onConfirm={async () => {
              const result = await deleteRole(roleId);
              if (result.ok) {
                toast.success(t('list.deleted', { name: roleName }));
              } else {
                toast.error(t(`errors.${result.error}`));
                router.refresh();
              }
            }}
          >
            <Trash2 data-icon="inline-start" />
            {t('list.delete')}
            <span className="sr-only">{roleName}</span>
          </ConfirmDialog>
        ))}
    </div>
  );
}
