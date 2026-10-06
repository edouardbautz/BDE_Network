import {
  normalizePermissions,
  unknownPermissionKeys,
  type PermissionDefinition,
} from '@/lib/permissions';

export const NAME_MAX_LENGTH = 40;
export const DESCRIPTION_MAX_LENGTH = 200;

/** What the role form submits. */
export interface RawRoleInput {
  name: string;
  description: string;
  allPermissions: boolean;
  permissions: string[];
}

export interface RoleData {
  name: string;
  description: string | null;
  allPermissions: boolean;
  /** Normalized: known keys, with what they imply, sorted. Empty when `allPermissions` is set. */
  permissions: string[];
}

export interface RoleInputErrors {
  name?: 'required' | 'tooLong' | 'invalid';
  description?: 'tooLong' | 'invalid';
  permissions?: 'unknown';
}

export type ParsedRoleInput = { ok: true; data: RoleData } | { ok: false; errors: RoleInputErrors };

/** Control characters (line breaks included) and the Unicode line separators: a name or a
 * description is one line of plain text. Checked by code point, no look-alike escapes needed. */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

/** Trims and collapses runs of spaces. Line breaks are control characters and are refused, not silently joined. */
function cleanLine(value: string): string {
  return value.trim().replace(/ {2,}/g, ' ');
}

/**
 * Validates the role form. Pure, so the form can run it in the browser and the server
 * runs it again: the browser is never trusted. A permission key that does not exist is
 * refused rather than dropped: it means a tampered request or a stale form.
 */
export function parseRoleInput(
  raw: RawRoleInput,
  definitions: readonly PermissionDefinition[],
): ParsedRoleInput {
  const errors: RoleInputErrors = {};

  const name = cleanLine(raw.name);
  if (name.length === 0) errors.name = 'required';
  else if (hasControlCharacters(name)) errors.name = 'invalid';
  else if (name.length > NAME_MAX_LENGTH) errors.name = 'tooLong';

  const description = cleanLine(raw.description);
  if (hasControlCharacters(description)) errors.description = 'invalid';
  else if (description.length > DESCRIPTION_MAX_LENGTH) errors.description = 'tooLong';

  if (unknownPermissionKeys(raw.permissions, definitions).length > 0) {
    errors.permissions = 'unknown';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      name,
      description: description.length > 0 ? description : null,
      allPermissions: raw.allPermissions === true,
      permissions: raw.allPermissions ? [] : normalizePermissions(raw.permissions, definitions),
    },
  };
}
