import type { Prisma } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';

type OwnerSyncClient = Pick<Prisma.TransactionClient, 'user' | 'role'>;

export interface OwnerSyncResult {
  /** Logins that had an account and became OWNER. */
  promoted: string[];
  /** Logins that were OWNER and no longer are (they are members again, or wait for approval). */
  demoted: string[];
}

const normalize = (login: string): string => login.trim().toLowerCase();

/**
 * Makes the accounts agree with the list of owners. OWNER is not something an account keeps by itself: the
 * session reads the status of the `User` row, and the sign-in used to be the only place that read the list
 * again. Taking someone off the list therefore left them OWNER until their next sign-in, which can be weeks
 * away (their cookie lasts 30 days). This applies the list at once:
 *
 *   - an account that is listed and is not OWNER becomes OWNER (nobody listed is held back);
 *   - an OWNER account that is not listed becomes an ordinary member with the default role (without a default
 *     role, which the database should never lack, it goes back to waiting for approval, as at sign-in).
 *
 * Someone listed who has no account yet becomes OWNER at their first sign-in, as before.
 */
export async function syncOwnerAccounts(
  tx: OwnerSyncClient,
  owners: readonly string[],
): Promise<OwnerSyncResult> {
  const wanted = new Set(owners.map(normalize));

  const accounts = await tx.user.findMany({
    where: {
      OR: [
        { status: 'OWNER' },
        ...owners.map((login) => ({ login: { equals: login, mode: 'insensitive' as const } })),
      ],
    },
    select: { id: true, login: true, status: true },
  });

  const promote = accounts.filter(
    (account) => wanted.has(normalize(account.login)) && account.status !== 'OWNER',
  );
  const demote = accounts.filter(
    (account) => !wanted.has(normalize(account.login)) && account.status === 'OWNER',
  );

  if (promote.length > 0) {
    await tx.user.updateMany({
      where: { id: { in: promote.map((account) => account.id) } },
      data: { status: 'OWNER', roleId: null },
    });
  }
  if (demote.length > 0) {
    const fallback = await tx.role.findFirst({ where: { isDefault: true }, select: { id: true } });
    await tx.user.updateMany({
      where: { id: { in: demote.map((account) => account.id) } },
      data: fallback
        ? { status: 'MEMBER', roleId: fallback.id }
        : { status: 'PENDING', roleId: null },
    });
  }

  return {
    promoted: promote.map((account) => account.login),
    demoted: demote.map((account) => account.login),
  };
}

/**
 * At start-up: applies the list of owners of the loaded settings to the accounts (see `syncOwnerAccounts`). It
 * matters for an installation whose list was changed through the files (BDE_REIMPORT, an edited bde.config.yml)
 * while the platform was stopped. Every change is audited, by "system".
 */
export async function reconcileOwnerAccounts(
  owners: readonly string[],
  db: Pick<typeof prisma, '$transaction'> = prisma,
): Promise<OwnerSyncResult> {
  return db.$transaction(async (tx) => {
    const result = await syncOwnerAccounts(tx, owners);
    for (const login of result.promoted) {
      await logAuditEvent(
        {
          actorLogin: 'system',
          action: 'settings.owner.sync',
          targetType: 'Settings',
          targetLabel: login,
          metadata: { change: 'promoted', reason: 'listed as an owner' },
        },
        tx,
      );
    }
    for (const login of result.demoted) {
      await logAuditEvent(
        {
          actorLogin: 'system',
          action: 'settings.owner.sync',
          targetType: 'Settings',
          targetLabel: login,
          metadata: { change: 'demoted', reason: 'no longer listed as an owner' },
        },
        tx,
      );
    }
    return result;
  });
}
