import { notFound } from 'next/navigation';
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
  // An id the BDE needs is missing: the account waits for approval goes to the step that asks it; an approved account is on a page the layout
  // covers with the window that asks it, and the page has nothing to draw (its session holds nothing).
  if (session.missingIds.length > 0) {
    if (session.realStatus === 'PENDING') return redirect({ href: '/identifiers', locale });
    return notFound();
  }
  if (!isApproved(session.user.status)) {
    return redirect({ href: '/pending', locale });
  }
  return session;
}
