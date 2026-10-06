'use client';

import { useTransition } from 'react';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { deleteRole, setDefaultRole } from '@/app/[locale]/(app)/roles/actions';
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

      {!isDefault && (
        <details className="relative">
          <summary className="inline-flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-[0.8rem] font-medium text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-ring/50">
            <Trash2 className="size-3.5" aria-hidden />
            {t('list.delete')}
            <span className="sr-only">{roleName}</span>
          </summary>
          <div className="bg-popover absolute right-0 z-10 mt-1 flex w-64 flex-col items-start gap-2 rounded-lg border p-3 text-left shadow-md">
            {memberCount > 0 ? (
              <p className="text-sm">{t('list.deleteInUse', { count: memberCount })}</p>
            ) : (
              <>
                <p className="text-sm">{t('list.deleteWarning', { name: roleName })}</p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    run(() => deleteRole(roleId), t('list.deleted', { name: roleName }))
                  }
                >
                  {t('list.deleteConfirm')}
                </Button>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
