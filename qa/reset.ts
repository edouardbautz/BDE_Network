import { buildDataset, type DatasetOptions } from './dataset';
import { BUILTIN_ADMIN, BUILTIN_MEMBER } from './personas';
import type { Queryable } from './invariants';

/**
 * Puts the database back to the dataset, as it was loaded: what the suites that change data (the access matrix, the
 * resilience and update campaigns) call between two scenarios. The settings row is left alone (it is the platform's,
 * and the running application holds it in memory); the two roles every platform has are restored as the migration
 * makes them.
 */
export async function resetDatabase(db: Queryable, options: DatasetOptions = {}): Promise<void> {
  await db.query(`
    BEGIN;
    DELETE FROM "AuditLog";
    DELETE FROM "NotificationTemplateVersion";
    DELETE FROM "NotificationTemplate";
    DELETE FROM "NotificationMention";
    DELETE FROM "EventReminder";
    DELETE FROM "IntraRequest";
    DELETE FROM "EventOccurrenceAssignee";
    DELETE FROM "EventOccurrence";
    DELETE FROM "EventCancellation";
    DELETE FROM "EventAssignee";
    DELETE FROM "Event";
    DELETE FROM "BdeCalendarFeed";
    DELETE FROM "User";
    DELETE FROM "Role" WHERE "id" NOT IN ('${BUILTIN_ADMIN.id}', '${BUILTIN_MEMBER.id}');
    COMMIT;`);
  for (const role of [BUILTIN_ADMIN, BUILTIN_MEMBER]) {
    await db.query(
      `UPDATE "Role" SET "name" = $1, "permissions" = $2, "allPermissions" = $3, "isDefault" = $4, "updatedAt" = now() WHERE "id" = $5`,
      [
        role.name,
        [...role.permissions],
        role.allPermissions,
        role.id === BUILTIN_MEMBER.id,
        role.id,
      ],
    );
  }
  await db.query(buildDataset(options).sql);
}
