'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { getConfig } from '@/config';
import { redirect } from '@/i18n/navigation';
import { permissionDefinitions, ROLES_MANAGE } from '@/lib/permissions';
import type { ActionResult, RoleErrorCode } from '@/lib/roles/errors';
import { execute, executeToResult } from '@/lib/roles/execute';
import { parseRoleInput, type RawRoleInput, type RoleInputErrors } from '@/lib/roles/input';
import * as roles from '@/lib/roles/service';

/**
 * Server actions of the roles pages. Same discipline as the members actions: each goes through
 * `execute` (permission, rights re-read from the database, escalation rules, audit entry, one
 * serializable transaction), and the form input is validated here again, whatever the browser
 * already checked.
 */

export interface RoleFormState {
  /** Problems with a field, to show next to it. */
  fieldErrors?: RoleInputErrors;
  /** The operation was refused: why. */
  error?: RoleErrorCode;
  /** What was submitted, so a refused form keeps what the user typed. */
  values?: RawRoleInput;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

function readRawInput(formData: FormData): RawRoleInput {
  return {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    allPermissions: formData.get('allPermissions') === 'on',
    permissions: formData.getAll('permissions').map(String),
  };
}

function revalidate(): void {
  revalidatePath('/roles');
  revalidatePath('/members');
}

async function leaveTo(saved: 'created' | 'updated'): Promise<never> {
  return redirect({
    href: { pathname: '/roles', query: { saved } },
    locale: await getLocale(),
  });
}

export async function createRole(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const raw = readRawInput(formData);
  const parsed = parseRoleInput(raw, permissionDefinitions(getConfig().modules.enabled));
  if (!parsed.ok) {
    return { fieldErrors: parsed.errors, values: raw };
  }

  const result = await execute(ROLES_MANAGE, (ctx) => roles.createRole(ctx, parsed.data));
  if (!result.ok) {
    return { error: result.error, values: raw };
  }

  revalidate();
  return leaveTo('created');
}

export async function updateRole(
  roleId: string,
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const raw = readRawInput(formData);
  if (!isId(roleId)) {
    return { error: 'roleNotFound', values: raw };
  }

  const parsed = parseRoleInput(raw, permissionDefinitions(getConfig().modules.enabled));
  if (!parsed.ok) {
    return { fieldErrors: parsed.errors, values: raw };
  }

  const result = await execute(ROLES_MANAGE, (ctx) => roles.updateRole(ctx, roleId, parsed.data));
  if (!result.ok) {
    return { error: result.error, values: raw };
  }

  revalidate();
  return leaveTo('updated');
}

export async function deleteRole(roleId: string): Promise<ActionResult> {
  if (!isId(roleId)) return { ok: false, error: 'roleNotFound' };

  const result = await executeToResult(ROLES_MANAGE, (ctx) => roles.deleteRole(ctx, roleId));
  if (result.ok) revalidate();
  return result;
}

export async function setDefaultRole(roleId: string): Promise<ActionResult> {
  if (!isId(roleId)) return { ok: false, error: 'roleNotFound' };

  const result = await executeToResult(ROLES_MANAGE, (ctx) => roles.setDefaultRole(ctx, roleId));
  if (result.ok) revalidate();
  return result;
}
