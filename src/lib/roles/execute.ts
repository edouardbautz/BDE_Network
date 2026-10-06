import { getConfig } from '@/config';
import type { Prisma } from '@/generated/prisma/client';
import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import { can, isApproved, resolvePermissionSet } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RoleRuleError, type ActionResult, type RoleErrorCode } from './errors';
import type { Actor } from './guards';
import type { Context } from './service';

/**
 * Runs one operation of service.ts the safe way. Every server action on roles and on who holds
 * them goes through here, so none can forget a step:
 *
 * 1. the session must hold the permission (a hidden button is not a permission check);
 * 2. the actor's rights are read again from the database *inside* the transaction, so a role
 *    edited a moment ago counts, whatever the session said when the page was drawn;
 * 3. the transaction is SERIALIZABLE and retried on conflict, so two requests racing on the
 *    same roles or members cannot both pass a check the other invalidates;
 * 4. a refusal rolls everything back and comes out as a plain code for the UI.
 *
 * A missing or insufficient permission throws "Forbidden" instead: nothing legitimate reaches
 * an action without it, so that is a crafted request, not something to explain nicely.
 */

const MAX_ATTEMPTS = 3;
/** Prisma's code for "the transaction could not be serialized, try again". */
const SERIALIZATION_FAILURE = 'P2034';
const UNIQUE_VIOLATION = 'P2002';

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Who is acting, from the database. While the owner simulates a role in development the
 * simulated rights apply (that is what is being tested), but writes stay under the real login. */
async function loadActor(
  tx: Prisma.TransactionClient,
  session: EffectiveSession,
  modules: readonly string[],
): Promise<Actor> {
  if (session.isImpersonating) {
    const { user } = session;
    return {
      id: user.id,
      login: user.login,
      status: user.status,
      roleId: user.roleId,
      set: { all: user.holdsAll, keys: new Set(user.permissions) },
    };
  }

  const account = await tx.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!account || !isApproved(account.status) || (account.status === 'MEMBER' && !account.role)) {
    throw new Error('Forbidden');
  }

  return {
    id: account.id,
    login: account.login,
    status: account.status,
    roleId: account.status === 'MEMBER' ? account.roleId : null,
    set: resolvePermissionSet(account.status, account.role, modules),
  };
}

export async function execute<T>(
  permission: string,
  work: (context: Context) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: RoleErrorCode }> {
  const session = await getEffectiveSession();
  if (!session || !can(session.user, permission)) {
    throw new Error('Forbidden');
  }
  const modules = getConfig().modules.enabled;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const value = await prisma.$transaction(
        async (tx) => {
          const actor = await loadActor(tx, session, modules);
          if (!actor.set.keys.has(permission)) {
            throw new Error('Forbidden');
          }
          return work({ tx, actor, modules, simulatedAs: session.simulatedAs });
        },
        { isolationLevel: 'Serializable' },
      );
      return { ok: true, value };
    } catch (error) {
      if (error instanceof RoleRuleError) {
        return { ok: false, error: error.code };
      }
      if (errorCode(error) === SERIALIZATION_FAILURE && attempt < MAX_ATTEMPTS) {
        continue;
      }
      if (errorCode(error) === SERIALIZATION_FAILURE || errorCode(error) === UNIQUE_VIOLATION) {
        return { ok: false, error: 'conflict' };
      }
      throw error;
    }
  }
}

/** For actions that return nothing but success or the reason they were refused. */
export async function executeToResult(
  permission: string,
  work: (context: Context) => Promise<unknown>,
): Promise<ActionResult> {
  const result = await execute(permission, work);
  return result.ok ? { ok: true } : result;
}
