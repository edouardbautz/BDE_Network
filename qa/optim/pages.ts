import type { PersonaKey } from '../personas';

/**
 * The pages the campaign measures: every page of the platform that a person opens on purpose, as the persona who opens it. The
 * paths hold the identifiers of the QA dataset (`FIXTURES` in qa/dataset.ts) and the month the dataset is built around, so the
 * same page is measured on every run. The pages of the intra exist only on the variant `events-intra`: they are not here.
 */
export interface MeasuredPage {
  name: string;
  who: PersonaKey;
  path: string;
}

export const MEASURED_PAGES: readonly MeasuredPage[] = [
  { name: 'login', who: 'anonymous', path: '/fr' },
  { name: 'privacy', who: 'anonymous', path: '/fr/privacy' },
  { name: 'dashboard', who: 'member', path: '/fr/dashboard' },
  { name: 'calendar', who: 'member', path: '/fr/events?view=calendar&month=2026-10' },
  { name: 'events-list', who: 'member', path: '/fr/events?view=list' },
  { name: 'event', who: 'member', path: '/fr/events/qa-fx-confirmed' },
  { name: 'event-series', who: 'member', path: '/fr/events/qa-fx-series' },
  { name: 'event-form', who: 'proposer', path: '/fr/events/new' },
  { name: 'event-edit', who: 'validator', path: '/fr/events/qa-fx-confirmed/edit' },
  { name: 'proposals', who: 'validator', path: '/fr/events/review' },
  { name: 'shared-calendar', who: 'owner', path: '/fr/events/shared-calendar' },
  { name: 'members', who: 'owner', path: '/fr/members' },
  { name: 'roles', who: 'owner', path: '/fr/roles' },
  { name: 'role-form', who: 'owner', path: '/fr/roles/new' },
  { name: 'audit-log', who: 'owner', path: '/fr/audit-log' },
  { name: 'settings', who: 'owner', path: '/fr/settings' },
  { name: 'notifications', who: 'owner', path: '/fr/notifications' },
  { name: 'profile', who: 'member', path: '/fr/profile' },
];
