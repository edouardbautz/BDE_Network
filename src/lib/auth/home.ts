import type { EffectiveSession } from './session';

/**
 * Where a signed-in account belongs (the login page sends it there, and each page that is not its place sends it back):
 * - an id the BDE needs is missing and the account is waiting for approval: **the step that asks it, before the waiting page**;
 * - an id is missing and the account is approved: its dashboard, where the layout draws the window that asks it (nothing else is sent: `getEffectiveSession`);
 * - otherwise the waiting page for an account that waits, and the dashboard for the others.
 * `user.status` is the downgraded one while an id is missing, so the real one (`realStatus`) is what decides here.
 */
export type Home = '/identifiers' | '/pending' | '/dashboard';

export function homeFor(session: EffectiveSession): Home {
  if (session.missingIds.length > 0) {
    return session.realStatus === 'PENDING' ? '/identifiers' : '/dashboard';
  }
  return session.user.status === 'PENDING' ? '/pending' : '/dashboard';
}
