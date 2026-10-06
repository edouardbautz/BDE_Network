'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  approveMember,
  changeMemberRole,
  rejectMember,
  removeMember,
} from '@/app/[locale]/(app)/members/actions';
import { NativeSelect } from '@/components/events/field-styles';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/roles/errors';

/** A role as the person looking can use it in a menu. */
export interface RoleChoice {
  id: string;
  name: string;
  /** They hold every permission it gives, so they may hand it out (see lib/roles/guards.ts). */
  grantable: boolean;
}

/** Why a member's role cannot be changed by the person looking. */
export type MemberLock = 'self' | 'above' | null;

function RoleOptions({ roles, currentId }: { roles: RoleChoice[]; currentId?: string }) {
  return roles.map((role) => (
    <option key={role.id} value={role.id} disabled={!role.grantable && role.id !== currentId}>
      {role.name}
    </option>
  ));
}

/** Shows what the server answered when it refused, in plain words. */
function useRefusal() {
  const t = useTranslations('roles');
  return (result: Exclude<ActionResult, { ok: true }>) => toast.error(t(`errors.${result.error}`));
}

interface MemberRoleSelectProps {
  userId: string;
  memberName: string;
  currentRoleId: string;
  roles: RoleChoice[];
  lock: MemberLock;
}

/** The drop-down that gives an approved member another role. */
export function MemberRoleSelect({
  userId,
  memberName,
  currentRoleId,
  roles,
  lock,
}: MemberRoleSelectProps) {
  const t = useTranslations('members');
  const refused = useRefusal();
  const [value, setValue] = useState(currentRoleId);
  const [isPending, startTransition] = useTransition();

  const change = (roleId: string) => {
    const previous = value;
    setValue(roleId);
    startTransition(async () => {
      const result = await changeMemberRole(userId, roleId);
      if (result.ok) {
        toast.success(t('roleChanged', { name: memberName }));
      } else {
        setValue(previous);
        refused(result);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        aria-label={t('roleOf', { name: memberName })}
        value={value}
        disabled={lock !== null || isPending}
        onChange={(event) => change(event.target.value)}
        className="min-w-40"
      >
        <RoleOptions roles={roles} currentId={currentRoleId} />
      </NativeSelect>
      {lock && <span className="text-muted-foreground text-xs">{t(`locked.${lock}`)}</span>}
    </div>
  );
}

interface PendingMemberActionsProps {
  userId: string;
  memberName: string;
  roles: RoleChoice[];
  /** The role offered first (the default one, when the person looking may give it). */
  initialRoleId: string;
}

/** Approve a request with the role chosen next to the button, or refuse it. */
export function PendingMemberActions({
  userId,
  memberName,
  roles,
  initialRoleId,
}: PendingMemberActionsProps) {
  const t = useTranslations('members');
  const refused = useRefusal();
  const [roleId, setRoleId] = useState(initialRoleId);
  const [isPending, startTransition] = useTransition();
  const canApprove = roles.some((role) => role.id === roleId && role.grantable);

  const run = (work: () => Promise<ActionResult>, success: string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(success);
      else refused(result);
    });

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <NativeSelect
        aria-label={t('roleToGive', { name: memberName })}
        value={roleId}
        disabled={isPending}
        onChange={(event) => setRoleId(event.target.value)}
        className="min-w-40"
      >
        <RoleOptions roles={roles} />
      </NativeSelect>
      <Button
        size="sm"
        disabled={isPending || !canApprove}
        onClick={() =>
          run(() => approveMember(userId, roleId), t('approved', { name: memberName }))
        }
      >
        {t('approve')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run(() => rejectMember(userId), t('rejected', { name: memberName }))}
      >
        {t('reject')}
      </Button>
    </div>
  );
}

interface RemoveMemberProps {
  userId: string;
  login: string;
  memberName: string;
}

/** "Retirer du BDE" asks first: it deletes the account and cannot be undone. */
export function RemoveMemberButton({ userId, login, memberName }: RemoveMemberProps) {
  const t = useTranslations('members');
  const refused = useRefusal();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const result = await removeMember(userId);
      if (!result.ok) {
        refused(result);
        return;
      }
      toast.success(t('removed', { name: memberName }));
      // Back to the list with the login: the page offers to replace the shared calendar link.
      router.push({ pathname: '/members', query: { removed: login } });
    });

  return (
    <details className="relative">
      <summary className="inline-flex h-7 cursor-pointer list-none items-center rounded-lg bg-destructive/10 px-2.5 text-[0.8rem] font-medium text-destructive outline-none hover:bg-destructive/20 focus-visible:ring-3 focus-visible:ring-ring/50">
        {t('remove')}
        <span className="sr-only">{memberName}</span>
      </summary>
      <div className="bg-popover absolute right-0 z-10 mt-1 flex w-64 flex-col items-start gap-2 rounded-lg border p-3 text-left shadow-md">
        <p className="text-sm">{t('removeWarning', { name: memberName })}</p>
        <Button variant="destructive" size="sm" disabled={isPending} onClick={remove}>
          {t('removeConfirm')}
        </Button>
      </div>
    </details>
  );
}
