/**
 * Why an operation on roles or members was refused. Plain codes, translated by the UI
 * (messages `roles.errors.*`): the rules themselves live in guards.ts.
 */
export const ROLE_ERROR_CODES = [
  'roleNotFound',
  'targetNotFound',
  'nameTaken',
  'unknownPermission',
  /** Would give a permission the actor does not hold. */
  'cannotGrant',
  /** The role gives rights the actor does not hold, so it is not theirs to edit, delete or hand out. */
  'cannotManageRole',
  /** The member's current role gives rights the actor does not hold. */
  'cannotManageMember',
  /** The actor's own role: nobody edits the role they hold. */
  'ownRole',
  'isDefault',
  'roleInUse',
  'targetIsSelf',
  'targetIsOwner',
  'targetNotMember',
  'targetNotPending',
  'noDefaultRole',
  'conflict',
] as const;

export type RoleErrorCode = (typeof ROLE_ERROR_CODES)[number];

export type ActionResult = { ok: true } | { ok: false; error: RoleErrorCode };

/** Thrown inside a transaction to roll it back and report a refusal (not a bug). */
export class RoleRuleError extends Error {
  constructor(public readonly code: RoleErrorCode) {
    super(`Refused: ${code}`);
  }
}
