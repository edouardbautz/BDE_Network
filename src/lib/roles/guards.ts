import type { UserStatus } from '@/generated/prisma/client';
import { holdsAllOf, type PermissionSet } from '@/lib/permissions';
import type { RoleErrorCode } from './errors';

/**
 * The rules that stop anyone from gaining rights they were not given. Pure functions of what
 * the actor holds and what is being touched, each returning the reason for refusing or null.
 * Every operation re-checks them on the server, inside the transaction that does the write.
 *
 * The one idea behind all of them: you can only hand out, edit or take away what you hold
 * yourself. A role is *covered* by the actor when the actor holds every permission it grants
 * (a role with "all permissions" is covered only by someone who holds all of them too, since it
 * grows with every module added later).
 */

/** Who is acting, with the rights they hold *now* (read from the database, not the session). */
export interface Actor {
  id: string;
  login: string;
  status: UserStatus;
  /** The role they hold; null for an owner. */
  roleId: string | null;
  set: PermissionSet;
}

/** A role, reduced to what the rules need. */
export interface RoleFacts {
  id: string;
  set: PermissionSet;
}

export type Rule = RoleErrorCode | null;

const covers = (actor: Actor, target: PermissionSet): boolean => holdsAllOf(actor.set, target);

/** Creating a role, or giving it a new permission set, never grants what the actor lacks. */
export function ruleGrant(actor: Actor, wanted: PermissionSet): Rule {
  return covers(actor, wanted) ? null : 'cannotGrant';
}

/** Editing, deleting or re-flagging a role: not the actor's own, and one they fully cover. */
export function ruleManageRole(actor: Actor, role: RoleFacts): Rule {
  if (actor.roleId !== null && role.id === actor.roleId) return 'ownRole';
  return covers(actor, role.set) ? null : 'cannotManageRole';
}

export function ruleUpdateRole(actor: Actor, role: RoleFacts, next: PermissionSet): Rule {
  return ruleManageRole(actor, role) ?? ruleGrant(actor, next);
}

export function ruleDeleteRole(
  actor: Actor,
  role: RoleFacts & { isDefault: boolean },
  memberCount: number,
): Rule {
  const refused = ruleManageRole(actor, role);
  if (refused) return refused;
  if (role.isDefault) return 'isDefault';
  return memberCount > 0 ? 'roleInUse' : null;
}

export function ruleSetDefaultRole(actor: Actor, role: RoleFacts): Rule {
  return ruleManageRole(actor, role);
}

/**
 * Giving an approved member another role. Never oneself, never an owner (their status comes
 * from the config), and both ends are covered: the role they hold now (otherwise anyone
 * with members.manage could demote a superior to a lesser role) and the one they get.
 * Colleagues with the same rights as the actor can be moved: the audit log records it.
 */
export function ruleAssignRole(
  actor: Actor,
  target: { id: string; status: UserStatus; role: RoleFacts | null },
  next: RoleFacts,
): Rule {
  if (target.id === actor.id) return 'targetIsSelf';
  if (target.status === 'OWNER') return 'targetIsOwner';
  if (target.status !== 'MEMBER' || !target.role) return 'targetNotMember';
  if (!covers(actor, target.role.set)) return 'cannotManageMember';
  return ruleGrant(actor, next.set);
}

/** Approving a pending account with a role the actor could hand out. */
export function ruleApprove(
  actor: Actor,
  target: { id: string; status: UserStatus },
  role: RoleFacts,
): Rule {
  if (target.id === actor.id) return 'targetIsSelf';
  if (target.status !== 'PENDING') return 'targetNotPending';
  return ruleGrant(actor, role.set);
}

/** Refusing a request or removing a member: never oneself or an owner, and a member's role must be covered. */
export function ruleRemove(
  actor: Actor,
  target: { id: string; status: UserStatus; role: RoleFacts | null },
): Rule {
  if (target.id === actor.id) return 'targetIsSelf';
  if (target.status === 'OWNER') return 'targetIsOwner';
  if (target.status === 'MEMBER' && (!target.role || !covers(actor, target.role.set))) {
    return 'cannotManageMember';
  }
  return null;
}
