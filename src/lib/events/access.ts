import { getConfig } from '@/config';
import { EVENTS_MODULE_KEY } from '@/config/schema';
import type { Role } from '@/generated/prisma/client';
import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import { getUserModuleKeys, hasModuleAccess, isApproved } from '@/lib/permissions';

export { EVENTS_MODULE_KEY };

/** Whether `modules.enabled` in bde.config.yml contains "events". When it
 * does not, no route, link, API or scheduler of the module is reachable. */
export function isEventsModuleEnabled(): boolean {
  return getConfig().modules.enabled.includes(EVENTS_MODULE_KEY);
}

/** Every approved member can read confirmed events. */
export function canViewEvents(role: Role): boolean {
  return isApproved(role);
}

/** Creating, editing, deleting and seeing drafts requires the "events"
 * module permission (granted by an admin); OWNER always has it. */
export function canManageEvents(role: Role, grantedModuleKeys: string[]): boolean {
  return isApproved(role) && hasModuleAccess(role, grantedModuleKeys, EVENTS_MODULE_KEY);
}

export interface EventsAccess {
  session: EffectiveSession;
  /** True when this user may create/edit/delete events and see drafts. */
  canManage: boolean;
}

/** The single entry point for pages and actions of the events module.
 * Returns null when the module is disabled, nobody is signed in, or the
 * account is not approved — callers treat that as "not found"/"forbidden". */
export async function getEventsAccess(): Promise<EventsAccess | null> {
  if (!isEventsModuleEnabled()) {
    return null;
  }

  const session = await getEffectiveSession();
  if (!session?.user || !canViewEvents(session.user.role)) {
    return null;
  }

  const moduleKeys = await getUserModuleKeys(session.user.id);
  return { session, canManage: canManageEvents(session.user.role, moduleKeys) };
}

/** Same as getEventsAccess but throws unless the user may manage events.
 * Every mutating server action starts with this: a hidden button is not a
 * permission check. */
export async function requireEventsManager(): Promise<EventsAccess> {
  const access = await getEventsAccess();
  if (!access?.canManage) {
    throw new Error('Forbidden');
  }
  return access;
}
