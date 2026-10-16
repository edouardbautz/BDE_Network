import { encode } from '@auth/core/jwt';

/**
 * The nine profiles every quality suite plays: who is looking at the platform. The same list serves the data
 * (`dataset.ts` creates their accounts), the HTTP suites (a session cookie forged for each) and the unit suites.
 *
 * "Module disabled" is not somebody: it is a way of running the platform, so it is a variant of the platform
 * (`PLATFORM_VARIANTS`), not a persona.
 */

export type PersonaKey =
  | 'anonymous'
  | 'pending'
  | 'member'
  | 'proposer'
  | 'validator'
  | 'custom'
  | 'admin'
  | 'owner'
  | 'deleted';

export interface PersonaRole {
  id: string;
  name: string;
  description: string;
  permissions: readonly string[];
  allPermissions: boolean;
  /** Made by the first migration of every platform: the dataset does not create it. */
  builtin: boolean;
}

export interface Persona {
  key: PersonaKey;
  /** What the matrix says about it, in a few words. */
  label: string;
  /** null: nobody (the visitor with no cookie). */
  login: string | null;
  /** The account the database holds for it, or null when it holds none. */
  status: 'OWNER' | 'MEMBER' | 'PENDING' | null;
  role: PersonaRole | null;
  /** Whether the browser carries a session cookie. */
  hasCookie: boolean;
}

export const BUILTIN_MEMBER: PersonaRole = {
  id: 'role-member',
  name: 'Membre',
  description: 'The default role of every platform.',
  permissions: ['events.view'],
  allPermissions: false,
  builtin: true,
};

export const BUILTIN_ADMIN: PersonaRole = {
  id: 'role-admin',
  name: 'Admin',
  description: 'Every right of every module.',
  permissions: [],
  allPermissions: true,
  builtin: true,
};

export const ROLE_PROPOSER: PersonaRole = {
  id: 'role-qa-proposer',
  name: 'QA Proposeur',
  description: 'Proposes events, cannot publish them.',
  permissions: ['events.view', 'events.propose'],
  allPermissions: false,
  builtin: false,
};

export const ROLE_VALIDATOR: PersonaRole = {
  id: 'role-qa-validator',
  name: 'QA Validateur',
  description: 'Validates and publishes events.',
  permissions: ['events.view', 'events.propose', 'events.validate'],
  allPermissions: false,
  builtin: false,
};

/** A custom role that has nothing to do with events: it manages members. */
export const ROLE_CUSTOM: PersonaRole = {
  id: 'role-qa-custom',
  name: 'QA Secrétariat',
  description: 'Manages members, sees the events.',
  permissions: ['members.manage', 'events.view'],
  allPermissions: false,
  builtin: false,
};

export const PERSONAS: readonly Persona[] = [
  {
    key: 'anonymous',
    label: 'visitor, signed out',
    login: null,
    status: null,
    role: null,
    hasCookie: false,
  },
  {
    key: 'pending',
    label: 'account waiting for approval',
    login: 'qa-pending',
    status: 'PENDING',
    role: null,
    hasCookie: true,
  },
  {
    key: 'member',
    label: 'member, default role',
    login: 'qa-member',
    status: 'MEMBER',
    role: BUILTIN_MEMBER,
    hasCookie: true,
  },
  {
    key: 'proposer',
    label: 'member who proposes events',
    login: 'qa-proposer',
    status: 'MEMBER',
    role: ROLE_PROPOSER,
    hasCookie: true,
  },
  {
    key: 'validator',
    label: 'member who validates events',
    login: 'qa-validator',
    status: 'MEMBER',
    role: ROLE_VALIDATOR,
    hasCookie: true,
  },
  {
    key: 'custom',
    label: 'member with a custom role (members only)',
    login: 'qa-custom',
    status: 'MEMBER',
    role: ROLE_CUSTOM,
    hasCookie: true,
  },
  {
    key: 'admin',
    label: 'member with the Admin role',
    login: 'qa-admin',
    status: 'MEMBER',
    role: BUILTIN_ADMIN,
    hasCookie: true,
  },
  { key: 'owner', label: 'owner', login: 'qa-owner', status: 'OWNER', role: null, hasCookie: true },
  {
    key: 'deleted',
    label: 'removed member whose cookie is still valid',
    login: 'qa-deleted',
    status: null,
    role: null,
    hasCookie: true,
  },
];

export function persona(key: PersonaKey): Persona {
  const found = PERSONAS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no persona ${key}`);
  return found;
}

/** The way a platform is run for a suite. */
export const PLATFORM_VARIANTS = ['events-enabled', 'events-disabled'] as const;
export type PlatformVariant = (typeof PLATFORM_VARIANTS)[number];

/** The cookie Auth.js sets over plain HTTP (the QA platforms are never behind HTTPS). */
export const SESSION_COOKIE = 'authjs.session-token';

/** The session cookie of somebody, signed with the platform's own secret exactly as Auth.js writes it. */
export async function forgeSessionCookie(login: string, secret: string): Promise<string> {
  return encode({ token: { login }, secret, salt: SESSION_COOKIE });
}

/** The value of the `Cookie` header for a persona, or null for the visitor who has none. */
export async function cookieHeaderFor(who: Persona, secret: string): Promise<string | null> {
  if (!who.hasCookie || !who.login) return null;
  return `${SESSION_COOKIE}=${await forgeSessionCookie(who.login, secret)}`;
}
