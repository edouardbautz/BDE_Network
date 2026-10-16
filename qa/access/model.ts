import { PERSONAS, type PersonaKey, type PlatformVariant } from '../personas';

/**
 * What each persona is supposed to be allowed to do, written down on its own: this is the EXPECTATION the matrix holds
 * the platform to, so it deliberately does not import the code that decides (`src/lib/permissions`). When the two
 * disagree, one of them is wrong, and finding out which is the point.
 */

export type Right =
  | 'members.manage'
  | 'roles.manage'
  | 'events.view'
  | 'events.propose'
  | 'events.validate'
  | 'events.shared_calendar';

const EVERY_RIGHT: readonly Right[] = [
  'members.manage',
  'roles.manage',
  'events.view',
  'events.propose',
  'events.validate',
  'events.shared_calendar',
];

/** The rights each persona holds (what a role grants, with what each right implies). */
export const RIGHTS: Record<PersonaKey, readonly Right[]> = {
  anonymous: [],
  deleted: [],
  pending: [],
  member: ['events.view'],
  proposer: ['events.view', 'events.propose'],
  validator: ['events.view', 'events.propose', 'events.validate'],
  custom: ['members.manage', 'events.view'],
  admin: EVERY_RIGHT,
  owner: EVERY_RIGHT,
};

/** Accounts the platform knows and has approved: the only ones that reach the pages of the application. */
export const APPROVED: readonly PersonaKey[] = [
  'member',
  'proposer',
  'validator',
  'custom',
  'admin',
  'owner',
];

export const isApproved = (who: PersonaKey): boolean => APPROVED.includes(who);
export const isOwner = (who: PersonaKey): boolean => who === 'owner';

/** Whether a persona holds a right on a platform run in this way (the rights of a module that is off are ignored). */
export function can(
  who: PersonaKey,
  right: Right,
  variant: PlatformVariant = 'events-enabled',
): boolean {
  if (!isApproved(who)) return false;
  if (right.startsWith('events.') && variant === 'events-disabled') return false;
  return RIGHTS[who].includes(right);
}

export const personasWhere = (test: (who: PersonaKey) => boolean): PersonaKey[] =>
  PERSONAS.map((persona) => persona.key).filter(test);

/** The locale of the paths the matrix opens. */
export const LOCALE = 'fr';
