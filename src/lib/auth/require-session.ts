import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { isApproved } from '@/lib/permissions';
import { getEffectiveSession, type EffectiveSession } from './session';

/**
 * The session of an approved account, or a redirect: no session goes to the login page, an
 * account still waiting goes to the waiting page. For pages that only show the signed-in
 * person's own data and so check no permission: the `(app)` layout already does the same, but a
 * layout is not a security boundary (it can be bypassed by moving a page, and the page renders
 * independently of it), so the page asks for itself.
 */
export async function requireApprovedSession(): Promise<EffectiveSession> {
  const session = await getEffectiveSession();
  const locale = await getLocale();

  if (!session) {
    return redirect({ href: '/', locale });
  }
  if (!isApproved(session.user.status)) {
    return redirect({ href: '/pending', locale });
  }
  return session;
}
