import type { Prisma, Role } from '@/generated/prisma/client';
import { simulationAuditFields } from '@/lib/audit-fields';
import { logAuditEvent } from '@/lib/audit-log';
import {
  activePermissionKeys,
  normalizePermissions,
  permissionDefinitions,
  resolvePermissionSet,
} from '@/lib/permissions';
import { RoleRuleError, type RoleErrorCode } from './errors';
import {
  ruleApprove,
  ruleAssignRole,
  ruleDeleteRole,
  ruleGrant,
  ruleRemove,
  ruleSetDefaultRole,
  ruleUpdateRole,
  type Actor,
  type Rule,
  type RoleFacts,
} from './guards';
import type { RoleData } from './input';

/**
 * Every write on roles and on who holds them. Each function runs inside the transaction of its
 * caller (see execute.ts), checks the rules of guards.ts against rights read from the database
 * in that same transaction, writes, and records the audit entry in the same transaction:
 * what was changed and what was logged cannot differ.
 *
 * A refusal throws a RoleRuleError, which rolls the transaction back.
 */

export interface Context {
  tx: Prisma.TransactionClient;
  actor: Actor;
  /** `modules.enabled` of bde.config.yml. */
  modules: readonly string[];
  /** Set while the owner simulates a role in development: recorded in the audit entry. */
  simulatedAs: string | null;
}

function check(rule: Rule): void {
  if (rule) throw new RoleRuleError(rule);
}

function refuse(code: RoleErrorCode): never {
  throw new RoleRuleError(code);
}

type RoleRecord = Pick<
  Role,
  'id' | 'name' | 'description' | 'permissions' | 'allPermissions' | 'isDefault'
>;

function facts(role: RoleRecord, modules: readonly string[]): RoleFacts {
  return { id: role.id, set: resolvePermissionSet('MEMBER', role, modules) };
}

async function audit(
  ctx: Context,
  entry: {
    action: string;
    targetType: 'Role' | 'User';
    targetId?: string;
    targetLabel: string;
    metadata?: Prisma.InputJsonObject;
  },
): Promise<void> {
  await logAuditEvent(
    {
      actorLogin: ctx.actor.login,
      actorId: ctx.actor.id,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel,
      metadata: {
        ...entry.metadata,
        ...simulationAuditFields(ctx.simulatedAs),
      },
    },
    ctx.tx,
  );
}

async function findRole(ctx: Context, roleId: string): Promise<RoleRecord> {
  const role = await ctx.tx.role.findUnique({ where: { id: roleId } });
  return role ?? refuse('roleNotFound');
}

async function findMember(ctx: Context, userId: string) {
  const user = await ctx.tx.user.findUnique({ where: { id: userId }, include: { role: true } });
  return user ?? refuse('targetNotFound');
}

/** Role names are unique whatever their case ("trésorier" is "Trésorier"). */
async function ensureNameFree(ctx: Context, name: string, exceptId?: string): Promise<void> {
  const clash = await ctx.tx.role.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) refuse('nameTaken');
}

/**
 * The permissions kept in a role that the registry no longer lists (the module was
 * disabled): they are ignored, not deleted, so enabling the module again brings them back.
 * An edit never touches them, whatever the form says.
 */
function hiddenPermissions(role: RoleRecord, modules: readonly string[]): string[] {
  const active = new Set(activePermissionKeys(modules));
  return role.permissions.filter((key) => !active.has(key));
}

export async function createRole(ctx: Context, data: RoleData): Promise<{ id: string }> {
  check(ruleGrant(ctx.actor, resolvePermissionSet('MEMBER', data, ctx.modules)));
  await ensureNameFree(ctx, data.name);

  const role = await ctx.tx.role.create({
    data: {
      name: data.name,
      description: data.description,
      allPermissions: data.allPermissions,
      permissions: data.permissions,
    },
  });

  await audit(ctx, {
    action: 'role.create',
    targetType: 'Role',
    targetId: role.id,
    targetLabel: role.name,
    metadata: { allPermissions: role.allPermissions, permissions: role.permissions },
  });
  return { id: role.id };
}

export async function updateRole(ctx: Context, roleId: string, data: RoleData): Promise<void> {
  const role = await findRole(ctx, roleId);

  const permissions = data.allPermissions
    ? hiddenPermissions(role, ctx.modules)
    : [...new Set([...data.permissions, ...hiddenPermissions(role, ctx.modules)])].sort();
  const next = { permissions, allPermissions: data.allPermissions };

  check(
    ruleUpdateRole(
      ctx.actor,
      facts(role, ctx.modules),
      resolvePermissionSet('MEMBER', next, ctx.modules),
    ),
  );
  if (data.name.toLowerCase() !== role.name.toLowerCase()) {
    await ensureNameFree(ctx, data.name, role.id);
  }

  const definitions = permissionDefinitions(ctx.modules);
  const before = new Set(normalizePermissions(role.permissions, definitions));
  const after = new Set(normalizePermissions(permissions, definitions));
  const added = [...after].filter((key) => !before.has(key)).sort();
  const removed = [...before].filter((key) => !after.has(key)).sort();

  const changes: Record<string, Prisma.InputJsonValue> = {};
  if (data.name !== role.name) changes.name = { from: role.name, to: data.name };
  if (data.description !== role.description) changes.description = true;
  if (data.allPermissions !== role.allPermissions) {
    changes.allPermissions = { from: role.allPermissions, to: data.allPermissions };
  }
  if (added.length > 0) changes.permissionsAdded = added;
  if (removed.length > 0) changes.permissionsRemoved = removed;

  if (Object.keys(changes).length === 0) {
    return;
  }

  await ctx.tx.role.update({
    where: { id: role.id },
    data: {
      name: data.name,
      description: data.description,
      allPermissions: data.allPermissions,
      permissions,
    },
  });

  await audit(ctx, {
    action: 'role.update',
    targetType: 'Role',
    targetId: role.id,
    targetLabel: data.name,
    metadata: { changes },
  });
}

export async function deleteRole(ctx: Context, roleId: string): Promise<void> {
  const role = await findRole(ctx, roleId);
  const memberCount = await ctx.tx.user.count({ where: { roleId: role.id } });

  check(
    ruleDeleteRole(
      ctx.actor,
      { ...facts(role, ctx.modules), isDefault: role.isDefault },
      memberCount,
    ),
  );

  await ctx.tx.role.delete({ where: { id: role.id } });

  await audit(ctx, {
    action: 'role.delete',
    targetType: 'Role',
    targetId: role.id,
    targetLabel: role.name,
    metadata: { allPermissions: role.allPermissions, permissions: role.permissions },
  });
}

export async function setDefaultRole(ctx: Context, roleId: string): Promise<void> {
  const role = await findRole(ctx, roleId);
  check(ruleSetDefaultRole(ctx.actor, facts(role, ctx.modules)));

  if (role.isDefault) {
    return;
  }

  const previous = await ctx.tx.role.findFirst({
    where: { isDefault: true },
    select: { name: true },
  });
  await ctx.tx.role.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  await ctx.tx.role.update({ where: { id: role.id }, data: { isDefault: true } });

  await audit(ctx, {
    action: 'role.set_default',
    targetType: 'Role',
    targetId: role.id,
    targetLabel: role.name,
    metadata: previous ? { previous: previous.name } : {},
  });
}

/** Gives an approved member another role. */
export async function assignRole(ctx: Context, userId: string, roleId: string): Promise<void> {
  const target = await findMember(ctx, userId);
  const next = await findRole(ctx, roleId);

  check(
    ruleAssignRole(
      ctx.actor,
      {
        id: target.id,
        status: target.status,
        role: target.role ? facts(target.role, ctx.modules) : null,
      },
      facts(next, ctx.modules),
    ),
  );

  if (target.roleId === next.id) {
    return;
  }

  await ctx.tx.user.update({ where: { id: target.id }, data: { roleId: next.id } });

  await audit(ctx, {
    action: 'member.role_change',
    targetType: 'User',
    targetId: target.id,
    targetLabel: target.login,
    metadata: { from: target.role?.name ?? null, to: next.name },
  });
}

/** Approves a pending account and gives it its role in the same step. */
export async function approveMember(ctx: Context, userId: string, roleId: string): Promise<void> {
  const target = await findMember(ctx, userId);
  const role = await findRole(ctx, roleId);

  check(ruleApprove(ctx.actor, target, facts(role, ctx.modules)));

  // The status is part of the filter: two approvals at once cannot both win.
  const { count } = await ctx.tx.user.updateMany({
    where: { id: target.id, status: 'PENDING' },
    data: { status: 'MEMBER', roleId: role.id },
  });
  if (count !== 1) refuse('targetNotPending');

  await audit(ctx, {
    action: 'member.approve',
    targetType: 'User',
    targetId: target.id,
    targetLabel: target.login,
    metadata: { role: role.name },
  });
}

/** Refuses a pending request: the row is deleted. */
export async function rejectMember(ctx: Context, userId: string): Promise<void> {
  const target = await findMember(ctx, userId);
  if (target.status !== 'PENDING')
    refuse(target.status === 'OWNER' ? 'targetIsOwner' : 'targetNotPending');

  check(ruleRemove(ctx.actor, { id: target.id, status: target.status, role: null }));

  await ctx.tx.user.delete({ where: { id: target.id } });

  await audit(ctx, {
    action: 'member.reject',
    targetType: 'User',
    targetLabel: target.login,
  });
}

/** Who was removed, as the notification about it needs them (the row is gone by then). */
export interface RemovedMember {
  login: string;
  fullName: string;
  campus: string | null;
  photoUrl: string | null;
  roleName: string | null;
}

/** Removes an approved member from the BDE: the row is deleted. Returns who was removed. */
export async function removeMember(ctx: Context, userId: string): Promise<RemovedMember> {
  const target = await findMember(ctx, userId);
  if (target.status === 'PENDING') refuse('targetNotMember');

  check(
    ruleRemove(ctx.actor, {
      id: target.id,
      status: target.status,
      role: target.role ? facts(target.role, ctx.modules) : null,
    }),
  );

  await ctx.tx.user.delete({ where: { id: target.id } });

  await audit(ctx, {
    action: 'member.remove',
    targetType: 'User',
    targetLabel: target.login,
    metadata: { role: target.role?.name ?? null },
  });
  return {
    login: target.login,
    fullName: target.fullName,
    campus: target.campus,
    photoUrl: target.photoUrl,
    roleName: target.role?.name ?? null,
  };
}
