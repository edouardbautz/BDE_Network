import { describe, expect, it } from 'vitest';
import {
  NO_PERMISSIONS,
  permissionDefinitions,
  type PermissionDefinition,
} from '@/lib/permissions';
import fr from '../../../messages/fr.json';
import { buildPermissionGroups, describePermission, type Translate } from './permission-groups';

/** A translator over the real French catalog: `permissions.<path>`, `{name}` placeholders filled. */
const t: Translate = Object.assign(
  (key: string, values: Record<string, string | number> = {}) => {
    const found = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        fr.permissions,
      );
    if (typeof found !== 'string') throw new Error(`missing message ${key}`);
    return found.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  },
  {
    has: (key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          fr.permissions,
        ) !== undefined,
  },
);

/** The definition of `key` among those of the given enabled modules. */
function definitionOf(key: string, modules: string[] = []): PermissionDefinition {
  const found = permissionDefinitions(modules).find((definition) => definition.key === key);
  if (!found) throw new Error(`no permission ${key}`);
  return found;
}

describe('describePermission', () => {
  it('uses the messages written for the permission', () => {
    expect(describePermission(t, definitionOf('members.manage'))).toEqual({
      label: 'Gérer les membres',
      description: expect.stringContaining('demandes d'),
    });
  });

  it('gives every permission of the events module its own sentence', () => {
    const events = permissionDefinitions(['events']).filter((d) => d.section === 'events');
    expect(events.map((d) => d.key)).toEqual([
      'events.view',
      'events.manage',
      'events.shared_calendar',
    ]);
    for (const definition of events) {
      const { label, description } = describePermission(t, definition);
      expect(label).not.toContain('{');
      expect(description.length).toBeGreaterThan(20);
    }
  });

  it('builds a readable sentence for the module of a fork nobody translated', () => {
    expect(describePermission(t, definitionOf('finance.view', ['finance'])).label).toBe(
      'Consulter : finance',
    );
    expect(describePermission(t, definitionOf('finance.manage', ['finance'])).label).toBe(
      'Gérer : finance',
    );
  });
});

describe('buildPermissionGroups', () => {
  it('groups by section, core first, with the implications of each permission', () => {
    const groups = buildPermissionGroups(t, permissionDefinitions(['events']), {
      all: true,
      keys: new Set(),
    });

    expect(groups.map((group) => group.section)).toEqual(['core', 'events']);
    const events = groups.find((group) => group.section === 'events');
    expect(events?.title).toBe('Événements');
    const manage = events?.options.find((option) => option.key === 'events.manage');
    expect(manage?.implies).toEqual(['events.view']);
  });

  it('locks what the person editing does not hold, and nothing for someone who holds all', () => {
    const definitions = permissionDefinitions(['events']);
    const limited = buildPermissionGroups(t, definitions, {
      all: false,
      keys: new Set(['members.manage', 'events.view']),
    });
    const lockedKeys = limited.flatMap((group) =>
      group.options.filter((o) => o.locked).map((o) => o.key),
    );
    expect(lockedKeys).toEqual(['roles.manage', 'events.manage', 'events.shared_calendar']);

    const nothing = buildPermissionGroups(t, definitions, NO_PERMISSIONS);
    expect(nothing.flatMap((group) => group.options).every((option) => option.locked)).toBe(true);

    const everything = buildPermissionGroups(t, definitions, { all: true, keys: new Set() });
    expect(everything.flatMap((group) => group.options).some((option) => option.locked)).toBe(
      false,
    );
  });
});
