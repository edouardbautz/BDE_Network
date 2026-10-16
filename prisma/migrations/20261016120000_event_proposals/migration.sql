-- Proposing and validating events.
--
-- 1. An event can be PROPOSED (submitted for validation), and a refusal keeps its comment on the event.
-- 2. The "events.manage" permission is replaced by "events.propose" and "events.validate". Nobody loses a right:
--    validating includes everything managing did (create, edit, confirm, delete, see drafts), and holding it
--    includes proposing and viewing. Every role that held "events.manage" holds the three now, so a role is
--    still editable (the application refuses a permission it does not know) and nothing changes for its members.
--    A role with "all permissions" lists none and needs nothing.
--
-- Postgres runs this whole file as one transaction: it applies completely or not at all.

-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'PROPOSED';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "proposedAt" TIMESTAMP(3),
ADD COLUMN     "refusalComment" TEXT,
ADD COLUMN     "refusedAt" TIMESTAMP(3),
ADD COLUMN     "refusedByLogin" TEXT;

-- A refusal is a comment, its author and its date, or none of the three.
ALTER TABLE "Event" ADD CONSTRAINT "Event_refusal_complete" CHECK (
  ("refusalComment" IS NULL) = ("refusedAt" IS NULL) AND ("refusedByLogin" IS NULL) = ("refusedAt" IS NULL)
);

-- The record of what was converted, written before the roles change (it names the roles as they were).
INSERT INTO "AuditLog" ("id", "actorLogin", "action", "targetType", "targetLabel", "metadata")
SELECT
  'audit-event-proposals-migration',
  'system',
  'role.migrate',
  'Role',
  'Migration vers proposer et valider les événements',
  jsonb_build_object('roles', jsonb_agg(
    jsonb_build_object('id', r."id", 'name', r."name", 'previousPermissions', to_jsonb(r."permissions"))
    ORDER BY r."name"))
FROM "Role" r
WHERE 'events.manage' = ANY (r."permissions")
HAVING count(*) > 0;

-- "events.manage" becomes "events.validate", which includes "events.propose" and "events.view".
-- The list is kept sorted, the form the application stores it in.
UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT p
  FROM unnest(
    array_remove("permissions", 'events.manage') || ARRAY['events.propose', 'events.validate', 'events.view']
  ) AS p
  ORDER BY p
)
WHERE 'events.manage' = ANY ("permissions");
