'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  approveMember,
  changeMemberRole,
  rejectMember,
  removeMember,
} from '@/app/[locale]/(app)/members/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
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

/** Shows what the server answered when it refused, in plain words, and redraws the list: a
 * refusal often means the page was out of date (already approved, already removed...). */
function useRefusal() {
  const t = useTranslations('roles');
  const router = useRouter();
  return (result: Exclude<ActionResult, { ok: true }>) => {
    toast.error(t(`errors.${result.error}`));
    router.refresh();
  };
}

interface MemberRoleSelectProps {
  userId: string;
  memberName: string;
  currentRoleId: string;
  roles: RoleChoice[];
  lock: MemberLock;
}

/** The drop-down that gives an approved member another role, after a confirmation: the new
 * role is only applied once confirmed, and the menu keeps showing the current one until then. */
export function MemberRoleSelect({
  userId,
  memberName,
  currentRoleId,
  roles,
  lock,
}: MemberRoleSelectProps) {
  const t = useTranslations('members');
  const refused = useRefusal();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [value, setValue] = useState(currentRoleId);
  const [candidate, setCandidate] = useState<string | null>(null);

  const nameOf = (id: string) => roles.find((role) => role.id === id)?.name ?? '';

  const change = async () => {
    if (candidate === null) return;
    const result = await changeMemberRole(userId, candidate);
    if (result.ok) {
      setValue(candidate);
      toast.success(t('roleChanged', { name: memberName }));
    } else {
      refused(result);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        ref={selectRef}
        aria-label={t('roleOf', { name: memberName })}
        value={value}
        disabled={lock !== null}
        onChange={(event) => setCandidate(event.target.value)}
        className="min-w-40"
      >
        <RoleOptions roles={roles} currentId={currentRoleId} />
      </NativeSelect>
      {lock && <span className="text-muted-foreground text-xs">{t(`locked.${lock}`)}</span>}

      <ConfirmDialog
        open={candidate !== null}
        onOpenChange={(open) => {
          if (!open) setCandidate(null);
        }}
        returnFocusRef={selectRef}
        tone="default"
        title={t('roleChangeTitle', { name: memberName })}
        description={t('roleChangeBody', {
          name: memberName,
          from: nameOf(value),
          to: nameOf(candidate ?? value),
        })}
        confirmLabel={t('roleChangeConfirm')}
        onConfirm={change}
      />
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

/** Approve a request with the role chosen next to the button, or refuse it (after a confirmation). */
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

  const approve = () =>
    startTransition(async () => {
      const result = await approveMember(userId, roleId);
      if (result.ok) toast.success(t('approved', { name: memberName }));
      else refused(result);
    });

  const reject = async () => {
    const result = await rejectMember(userId);
    if (result.ok) toast.success(t('rejected', { name: memberName }));
    else refused(result);
  };

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
      <Button size="sm" disabled={isPending || !canApprove} onClick={approve}>
        {t('approve')}
      </Button>
      <ConfirmDialog
        title={t('rejectTitle', { name: memberName })}
        description={t('rejectWarning', { name: memberName })}
        confirmLabel={t('rejectConfirm')}
        onConfirm={reject}
      >
        {t('reject')}
        <span className="sr-only">{memberName}</span>
      </ConfirmDialog>
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

  const remove = async () => {
    const result = await removeMember(userId);
    if (!result.ok) {
      refused(result);
      return;
    }
    toast.success(t('removed', { name: memberName }));
    // Back to the list with the login: the page offers to replace the shared calendar link.
    router.push({ pathname: '/members', query: { removed: login } });
  };

  return (
    <ConfirmDialog
      title={t('removeTitle', { name: memberName })}
      description={t('removeWarning', { name: memberName })}
      confirmLabel={t('removeConfirm')}
      onConfirm={remove}
    >
      {t('remove')}
      <span className="sr-only">{memberName}</span>
    </ConfirmDialog>
  );
}
