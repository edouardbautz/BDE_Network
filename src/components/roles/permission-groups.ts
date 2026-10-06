import type { PermissionDefinition, PermissionSet } from '@/lib/permissions';
import type { PermissionGroup, PermissionOption } from './role-form';

/** The part of next-intl's translator these helpers use (`getTranslations('permissions')`). */
export interface Translate {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/** "Événements" for the module `events`; a fork's own module falls back to its key. */
export function sectionTitle(t: Translate, section: string): string {
  return t.has(`sections.${section}`) ? t(`sections.${section}`) : section;
}

/**
 * The label and one-sentence description of a permission. Every permission written for a
 * module has its own messages (`items.events.manage.label`); the generic view/manage of a
 * module nobody translated yet get a sentence built from the module's name.
 */
export function describePermission(
  t: Translate,
  definition: PermissionDefinition,
): { label: string; description: string } {
  const path = definition.key;
  if (t.has(`items.${path}.label`)) {
    return { label: t(`items.${path}.label`), description: t(`items.${path}.description`) };
  }

  const moduleName = sectionTitle(t, definition.section);
  const name = definition.key.slice(definition.section.length + 1);
  const generic = name === 'view' || name === 'manage' ? name : 'extra';
  return {
    label: t(`generic.${generic}.label`, { module: moduleName, name }),
    description: t(`generic.${generic}.description`, { module: moduleName, name }),
  };
}

/** The checkboxes of the role form, grouped by section, with what the person editing cannot give locked. */
export function buildPermissionGroups(
  t: Translate,
  definitions: readonly PermissionDefinition[],
  actor: PermissionSet,
): PermissionGroup[] {
  const groups = new Map<string, PermissionOption[]>();

  for (const definition of definitions) {
    const options = groups.get(definition.section) ?? [];
    options.push({
      key: definition.key,
      ...describePermission(t, definition),
      implies: [...definition.implies],
      locked: !actor.all && !actor.keys.has(definition.key),
    });
    groups.set(definition.section, options);
  }

  return [...groups].map(([section, options]) => ({
    section,
    title: sectionTitle(t, section),
    options,
  }));
}
