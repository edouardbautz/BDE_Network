import { getConfig } from '@/config';
import { EVENTS_MODULE_KEY } from '@/config/schema';
import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import {
  can,
  EVENTS_PROPOSE,
  EVENTS_VALIDATE,
  viewPermission,
  type PermissionHolder,
} from '@/lib/permissions';

import { intraPublicationEnabled } from './intra-config';

export { EVENTS_MODULE_KEY };

/** The permissions of the events module (see MODULE_EXTRA_PERMISSIONS in lib/permissions). There is no
 * "manage": who validates holds everything a manager did, and proposing is the part of it for people who may not
 * publish (see lib/events/review.ts). */
export const EVENTS_VIEW = viewPermission(EVENTS_MODULE_KEY);
export { EVENTS_PROPOSE, EVENTS_VALIDATE };
export const EVENTS_SHARED_CALENDAR = `${EVENTS_MODULE_KEY}.shared_calendar`;
/** Publishing on the intra: answering the requests of the school's staff page; following them read only; asking again. */
export const EVENTS_INTRA_PUBLISH = `${EVENTS_MODULE_KEY}.intra_publish`;
export const EVENTS_INTRA_VIEW = `${EVENTS_MODULE_KEY}.intra_view`;
export const EVENTS_INTRA_REQUEST = `${EVENTS_MODULE_KEY}.intra_request`;

/** Whether `modules.enabled` in bde.config.yml contains "events". When it
 * does not, no route, link, API or scheduler of the module is reachable. */
export function isEventsModuleEnabled(): boolean {
  return getConfig().modules.enabled.includes(EVENTS_MODULE_KEY);
}

/** Seeing the confirmed events takes the "view" permission of the module. */
export function canViewEvents(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_VIEW);
}

/** Creating an event (it waits for a validator, unless the author is one) takes "propose". */
export function canProposeEvents(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_PROPOSE);
}

/** Approving and refusing proposals, publishing, editing and deleting any event and seeing every draft take
 * "validate". */
export function canValidateEvents(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_VALIDATE);
}

/** The BDE-wide calendar link has its own permission, independent of managing events. */
export function canManageSharedCalendar(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_SHARED_CALENDAR);
}

export interface EventsAccess {
  session: EffectiveSession;
  /** True when this user holds "propose". */
  canPropose: boolean;
  /** True when this user may validate: publish, edit anything, delete and see every draft and proposal. */
  canValidate: boolean;
  /** True when this user may create events: as proposals, or published ones when they can validate. */
  canCreate: boolean;
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

  const canPropose = canProposeEvents(session.user);
  const canValidate = canValidateEvents(session.user);
  return { session, canPropose, canValidate, canCreate: canPropose || canValidate };
}

/** Same as getEventsAccess but throws unless the user may create events (propose, or validate which includes
 * it). Every action that writes an event starts with this, then asks lib/events/review.ts what this person may do
 * to this event: a hidden button is not a permission check. */
export async function requireEventsProposer(): Promise<EventsAccess> {
  const access = await getEventsAccess();
  if (!access?.canCreate) {
    throw new Error('Forbidden');
  }
  return access;
}

/** Same, for what only a validator does: approve, refuse, cancel a date, restore it. */
export async function requireEventsValidator(): Promise<EventsAccess> {
  const access = await getEventsAccess();
  if (!access?.canValidate) {
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

// ---- publishing on the intra -------------------------------------------------------------------------------------------------

/** Answering the requests: the staff of the school. Includes nothing, so a staff role sees the page of the requests and not the calendar. */
export function canPublishOnIntra(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_INTRA_PUBLISH);
}

/** Sending a request again, or one for an event that is already confirmed: the right of its own, or a validator's. */
export function canRequestOnIntra(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_INTRA_REQUEST) || can(holder, EVENTS_VALIDATE);
}

/** Seeing where each publication stands: following it, answering it or asking for it all need to. */
export function canFollowIntra(holder: PermissionHolder): boolean {
  return can(holder, EVENTS_INTRA_VIEW) || canPublishOnIntra(holder) || canRequestOnIntra(holder);
}

export interface IntraAccess {
  session: EffectiveSession;
  /** May answer the requests (published, refused, updated). */
  canPublish: boolean;
  /** May send a request (again). */
  canRequest: boolean;
}

/** The entry point of the pages and actions about publishing on the intra. Null when the module or the publication on the intra is
 * off, nobody is signed in, or the account holds none of the rights: callers treat that as "not found" or "forbidden". */
export async function getIntraAccess(): Promise<IntraAccess | null> {
  if (!isEventsModuleEnabled() || !intraPublicationEnabled()) return null;
  const session = await getEffectiveSession();
  if (!session || !canFollowIntra(session.user)) return null;
  return {
    session,
    canPublish: canPublishOnIntra(session.user),
    canRequest: canRequestOnIntra(session.user),
  };
}

/** Same, throwing unless the account may answer the requests. Every action that answers one starts with this. */
export async function requireIntraPublisher(): Promise<IntraAccess> {
  const access = await getIntraAccess();
  if (!access?.canPublish) throw new Error('Forbidden');
  return access;
}

/** Same, for sending a request. */
export async function requireIntraRequester(): Promise<IntraAccess> {
  const access = await getIntraAccess();
  if (!access?.canRequest) throw new Error('Forbidden');
  return access;
}
