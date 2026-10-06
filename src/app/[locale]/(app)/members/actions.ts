'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { notifyMemberApproved, notifyMemberRemoved } from '@/lib/members/notifications';
import { MEMBERS_MANAGE } from '@/lib/permissions';
import type { ActionResult } from '@/lib/roles/errors';
import { execute, executeToResult } from '@/lib/roles/execute';
import * as roles from '@/lib/roles/service';

/**
 * Server actions of the members panel. Each is its own HTTP entry point, so each goes through
 * `execute`: the permission is checked, the actor's rights are read again from the database,
 * every rule against privilege escalation is applied and the audit entry is written, all in
 * one transaction. See lib/roles/execute.ts and lib/roles/guards.ts.
 *
 * Notifications (`notifyMember*`) run after the response and never throw: approving or removing
 * someone cannot fail because a webhook or the SMTP server is down.
 *
 * Arguments come from the browser (a crafted request can send anything): an id that is not
 * a plain string is refused before it can reach a query.
 */

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

function done(result: ActionResult): ActionResult {
  if (result.ok) {
    revalidatePath('/members');
    revalidatePath('/roles');
  }
  return result;
}

/** Approves a pending account and gives it `roleId`. */
export async function approveMember(userId: string, roleId: string): Promise<ActionResult> {
  if (!isId(userId)) return { ok: false, error: 'targetNotFound' };
  if (!isId(roleId)) return { ok: false, error: 'roleNotFound' };

  let actorLogin = '';
  const result = done(
    await executeToResult(MEMBERS_MANAGE, (ctx) => {
      actorLogin = ctx.actor.login;
      return roles.approveMember(ctx, userId, roleId);
    }),
  );
  if (result.ok) after(() => notifyMemberApproved(userId, actorLogin));
  return result;
}

/** Gives an approved member another role. */
export async function changeMemberRole(userId: string, roleId: string): Promise<ActionResult> {
  if (!isId(userId)) return { ok: false, error: 'targetNotFound' };
  if (!isId(roleId)) return { ok: false, error: 'roleNotFound' };

  return done(
    await executeToResult(MEMBERS_MANAGE, (ctx) => roles.assignRole(ctx, userId, roleId)),
  );
}

/** Refuses a pending request (the row is deleted). */
export async function rejectMember(userId: string): Promise<ActionResult> {
  if (!isId(userId)) return { ok: false, error: 'targetNotFound' };

  return done(await executeToResult(MEMBERS_MANAGE, (ctx) => roles.rejectMember(ctx, userId)));
}

/** Removes an approved member from the BDE (the row is deleted). `login` is the one removed. */
export async function removeMember(
  userId: string,
): Promise<ActionResult | { ok: true; login: string }> {
  if (!isId(userId)) return { ok: false, error: 'targetNotFound' };

  let actorLogin = '';
  const result = await execute(MEMBERS_MANAGE, (ctx) => {
    actorLogin = ctx.actor.login;
    return roles.removeMember(ctx, userId);
  });
  if (!result.ok) return result;

  done({ ok: true });
  after(() => notifyMemberRemoved(result.value, actorLogin));
  return { ok: true, login: result.value.login };
}
