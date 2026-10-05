import type { UserStatus } from '@/generated/prisma/client';

/** What to show as someone's "role": the owner and pending labels are fixed, a member shows
 * the name of their custom role. `translate` is `getTranslations('roles')` (or its client twin). */
export function accountLabel(
  account: { status: UserStatus; roleName: string | null },
  translate: (key: UserStatus) => string,
): string {
  if (account.status === 'MEMBER' && account.roleName) {
    return account.roleName;
  }
  return translate(account.status);
}
