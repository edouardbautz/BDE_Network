import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import { can, NOTIFICATIONS_TEMPLATES } from '@/lib/permissions';

/**
 * Who may write the templates of the notifications: whoever holds the permission (an owner holds every one, and so does a role
 * with "all permissions"). The settings of the channels themselves (the webhooks, the mail server) stay the owners'.
 */

/** The person behind this request, for a page: null when nobody is signed in or they do not hold the permission. */
export async function getTemplateEditor(): Promise<EffectiveSession | null> {
  const session = await getEffectiveSession();
  return session && can(session.user, NOTIFICATIONS_TEMPLATES) ? session : null;
}

/** The person behind this request, for a server action: throws otherwise. A hidden link is not a permission check. */
export async function requireTemplateEditor(): Promise<EffectiveSession> {
  const session = await getTemplateEditor();
  if (!session) throw new Error('Forbidden');
  return session;
}
