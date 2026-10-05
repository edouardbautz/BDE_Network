import { getConfig } from '@/config';
import { EVENTS_MODULE_KEY } from '@/config/schema';
import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import { can, managePermission, viewPermission, type PermissionHolder } from '@/lib/permissions';

export { EVENTS_MODULE_KEY };

/** The permissions of the events module (see MODULE_EXTRA_PERMISSIONS in lib/permissions). */
export const EVENTS_VIEW = viewPermission(EVENTS_MODULE_KEY);
export const EVENTS_MANAGE = managePermission(EVENTS_MODULE_KEY);
export const EVENTS_SHARED_CALENDAR = `${EVENTS_MODULE_KEY}.shared_calendar`;

/** Whether `modules.enabled` in bde.config.yml contains "events". When it
 * does not, no route, link, API or scheduler of the module is reachable. */
export function isEventsModuleEnabled(): boolean {
  return getConfig().modules.enabled.includes(EVENTS_MODULE_KEY);
}

/** Seeing the confirmed events takes the "view" permission of the module. */
export function canViewEvents(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_VIEW);
}

/** Creating, editing, deleting and seeing drafts takes the "manage" permission. */
export function canManageEvents(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_MANAGE);
}

/** The BDE-wide calendar link has its own permission, independent of managing events. */
export function canManageSharedCalendar(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_SHARED_CALENDAR);
}

export interface EventsAccess {
  session: EffectiveSession;
  /** True when this user may create/edit/delete events and see drafts. */
  canManage: boolean;
}

/** The single entry point for pages and actions of the events module.
 * Returns null when the module is disabled, nobody is signed in, or the
 * account may not view events — callers treat that as "not found"/"forbidden". */
export async function getEventsAccess(): Promise<EventsAccess | null> {
  if (!isEventsModuleEnabled()) {
    return null;
  }

  const session = await getEffectiveSession();
  if (!session || !canViewEvents(session.user)) {
    return null;
  }

  return { session, canManage: canManageEvents(session.user) };
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

/** Same as getEventsAccess but throws unless the user may manage the BDE calendar
 * link. Every action that touches it starts with this. */
export async function requireSharedCalendarManager(): Promise<EventsAccess> {
  const access = await getEventsAccess();
  if (!access || !canManageSharedCalendar(access.session.user)) {
    throw new Error('Forbidden');
  }
  return access;
}
