import { EVENTS_MODULE_KEY } from '@/config/schema';

/**
 * The list of permissions a role can hold. It lives in code, not in the database:
 * a role stores plain keys ("events.manage"), checked against this list, so adding
 * a permission never needs a migration.
 *
 * - **Core** permissions belong to the platform itself.
 * - Every **enabled module** gets `<module>.view` and `<module>.manage` for free
 *   (managing includes viewing), whatever its key, so a fork's own module works
 *   without registering anything.
 * - A module that needs more declares them in `MODULE_EXTRA_PERMISSIONS` below.
 *   That one entry is all a new module (Finance, Meetings...) adds here.
 *
 * The audit log is not a permission: it is reserved for OWNER, always.
 */

export const CORE_SECTION = 'core';

export const MEMBERS_MANAGE = 'members.manage';
export const ROLES_MANAGE = 'roles.manage';

/** Permissions a module declares beyond view/manage: `{ moduleKey: ['name', ...] }` gives `moduleKey.name`. */
export const MODULE_EXTRA_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  [EVENTS_MODULE_KEY]: ['shared_calendar'],
};

export interface PermissionDefinition {
  /** e.g. "events.manage". */
  key: string;
  /** `core`, or the key of the module the permission belongs to: it groups the checkboxes. */
  section: string;
  /** Permissions this one includes: managing a module includes viewing it. */
  implies: readonly string[];
}

/** Module keys a permission key can be built from. A key with a dot or a space could not be parsed back. */
const MODULE_KEY = /^[a-z0-9_-]+$/i;

export function viewPermission(moduleKey: string): string {
  return `${moduleKey}.view`;
}

export function managePermission(moduleKey: string): string {
  return `${moduleKey}.manage`;
}

/** Every permission that exists for the given enabled modules, core first, in a stable order. */
export function permissionDefinitions(enabledModules: readonly string[]): PermissionDefinition[] {
  const definitions: PermissionDefinition[] = [
    { key: MEMBERS_MANAGE, section: CORE_SECTION, implies: [] },
    { key: ROLES_MANAGE, section: CORE_SECTION, implies: [] },
  ];

  for (const moduleKey of new Set(enabledModules)) {
    if (!MODULE_KEY.test(moduleKey)) continue;

    definitions.push(
      { key: viewPermission(moduleKey), section: moduleKey, implies: [] },
      {
        key: managePermission(moduleKey),
        section: moduleKey,
        implies: [viewPermission(moduleKey)],
      },
    );
    for (const extra of MODULE_EXTRA_PERMISSIONS[moduleKey] ?? []) {
      definitions.push({
        key: `${moduleKey}.${extra}`,
        section: moduleKey,
        implies: [viewPermission(moduleKey)],
      });
    }
  }

  return definitions;
}

/** The keys of {@link permissionDefinitions}. */
export function activePermissionKeys(enabledModules: readonly string[]): string[] {
  return permissionDefinitions(enabledModules).map((definition) => definition.key);
}

/**
 * Keeps only known keys, adds what they imply (ticking "manage" ticks "view"), removes
 * duplicates and sorts: the form a role is stored and compared in. Unknown keys are dropped
 * here; callers that must *refuse* them check with {@link unknownPermissionKeys} first.
 */
export function normalizePermissions(
  keys: Iterable<string>,
  definitions: readonly PermissionDefinition[],
): string[] {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const result = new Set<string>();

  for (const key of keys) {
    const definition = byKey.get(key);
    if (!definition) continue;
    result.add(key);
    for (const implied of definition.implies) result.add(implied);
  }

  return [...result].sort();
}

/** The keys that are not permissions of the enabled modules (typos, tampering, a disabled module). */
export function unknownPermissionKeys(
  keys: Iterable<string>,
  definitions: readonly PermissionDefinition[],
): string[] {
  const known = new Set(definitions.map((definition) => definition.key));
  return [...new Set(keys)].filter((key) => !known.has(key));
}
