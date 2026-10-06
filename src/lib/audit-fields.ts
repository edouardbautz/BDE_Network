/**
 * Extra audit metadata for an action performed while the owner simulates a role in development.
 * `actorLogin` / `actorId` always come from the real account; this only records that the role was
 * simulated. Empty outside dev impersonation. The one definition used by every audit entry
 * (members and roles, events, shared calendar).
 */
export function simulationAuditFields(simulatedAs: string | null): { simulatedAsRole?: string } {
  return simulatedAs ? { simulatedAsRole: simulatedAs } : {};
}
