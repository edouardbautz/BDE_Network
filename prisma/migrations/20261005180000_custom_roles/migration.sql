-- Custom roles replace the ADMIN / MEMBER enum and the per-user ModulePermission table.
--
-- Deterministic and independent of bde.config.yml. What each existing account becomes:
--
--   OWNER            -> status OWNER, no role (unchanged: it still comes from bde.config.yml)
--   PENDING          -> status PENDING, no role (unchanged)
--   ADMIN            -> status MEMBER, role "Admin" (all permissions except the owner-only audit log)
--   MEMBER           -> status MEMBER, role "Membre" (permission: events.view)
--   MEMBER with
--   module grants    -> status MEMBER, a generated role "Membre + <modules>" holding the "Membre"
--                       permissions plus <module>.view and <module>.manage for each module it was
--                       granted. One role per distinct set of modules, named from the sorted keys,
--                       with an id derived from them (md5): the same data always gives the same roles.
--
-- Nothing is lost: the previous role and module grants (with who granted them and when) of every
-- migrated account are recorded in one AuditLog entry, "role.migrate". The permissions of a module
-- that is not enabled are ignored by the application, hence "Membre" always gets events.view.
--
-- Postgres runs this whole file as one transaction: it applies completely or not at all.

-- The old enum and the new table are both called "Role": free the name first.
ALTER TYPE "Role" RENAME TO "Role_old";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('OWNER', 'MEMBER', 'PENDING');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allPermissions" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "roleId" TEXT,
ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'PENDING';

-- The two default roles (editable afterwards, by anyone who holds the permissions involved).
INSERT INTO "Role" ("id", "name", "description", "permissions", "allPermissions", "isDefault", "updatedAt")
VALUES
  ('role-admin', 'Admin',
   'Tous les droits, y compris ceux des futurs modules, sauf le journal d''audit (réservé aux propriétaires).',
   ARRAY[]::TEXT[], true, false, CURRENT_TIMESTAMP),
  ('role-member', 'Membre',
   'Consultation. C''est le rôle proposé aux nouveaux membres.',
   ARRAY['events.view']::TEXT[], false, true, CURRENT_TIMESTAMP);

-- Account status.
UPDATE "User"
SET "status" = (CASE "role"::text
  WHEN 'OWNER' THEN 'OWNER'
  WHEN 'PENDING' THEN 'PENDING'
  ELSE 'MEMBER'
END)::"UserStatus";

-- Roles for members that had module grants: one per distinct, sorted set of modules.
WITH grants AS (
  SELECT u."id" AS "userId", array_agg(mp."module" ORDER BY mp."module") AS "modules"
  FROM "User" u
  JOIN "ModulePermission" mp ON mp."userId" = u."id"
  WHERE u."role"::text = 'MEMBER'
  GROUP BY u."id"
),
sets AS (
  SELECT DISTINCT "modules" FROM grants
)
INSERT INTO "Role" ("id", "name", "description", "permissions", "allPermissions", "isDefault", "updatedAt")
SELECT
  'role-migrated-' || substr(md5(array_to_string("modules", ',')), 1, 12),
  'Membre + ' || (
    SELECT string_agg(CASE m WHEN 'events' THEN 'Événements' ELSE initcap(m) END, ' + ' ORDER BY m)
    FROM unnest("modules") AS m
  ),
  'Créé automatiquement lors du passage aux rôles personnalisés : les droits du rôle « Membre » '
    || 'plus la gestion de ' || (
    SELECT string_agg(CASE m WHEN 'events' THEN 'Événements' ELSE initcap(m) END, ', ' ORDER BY m)
    FROM unnest("modules") AS m
  ) || '.',
  ARRAY(
    SELECT DISTINCT p FROM (
      SELECT 'events.view' AS p
      UNION ALL SELECT m || '.view' FROM unnest("modules") AS m
      UNION ALL SELECT m || '.manage' FROM unnest("modules") AS m
    ) AS all_permissions ORDER BY p
  ),
  false,
  false,
  CURRENT_TIMESTAMP
FROM sets;

-- Attach every approved account to its role.
UPDATE "User" SET "roleId" = 'role-admin' WHERE "role"::text = 'ADMIN';

UPDATE "User" u
SET "roleId" = 'role-migrated-' || substr(md5(array_to_string(g."modules", ',')), 1, 12)
FROM (
  SELECT mp."userId", array_agg(mp."module" ORDER BY mp."module") AS "modules"
  FROM "ModulePermission" mp
  GROUP BY mp."userId"
) g
WHERE g."userId" = u."id" AND u."role"::text = 'MEMBER';

UPDATE "User" SET "roleId" = 'role-member' WHERE "role"::text = 'MEMBER' AND "roleId" IS NULL;

-- The record of what was converted, so the previous situation stays readable.
INSERT INTO "AuditLog" ("id", "actorLogin", "action", "targetType", "targetLabel", "metadata")
SELECT
  'audit-custom-roles-migration',
  'system',
  'role.migrate',
  'Role',
  'Migration vers les rôles personnalisés',
  jsonb_build_object('accounts', jsonb_agg(
    jsonb_build_object(
      'login', u."login",
      'previousRole', u."role"::text,
      'newRole', r."name",
      'moduleGrants', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'module', mp."module",
            'grantedByLogin', mp."grantedByLogin",
            'grantedAt', to_char(mp."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ) ORDER BY mp."module")
        FROM "ModulePermission" mp WHERE mp."userId" = u."id"
      ), '[]'::jsonb)
    ) ORDER BY u."login"))
FROM "User" u
LEFT JOIN "Role" r ON r."id" = u."roleId"
WHERE u."role"::text IN ('ADMIN', 'MEMBER')
   OR EXISTS (SELECT 1 FROM "ModulePermission" mp WHERE mp."userId" = u."id")
HAVING count(*) > 0;

-- DropForeignKey
ALTER TABLE "ModulePermission" DROP CONSTRAINT "ModulePermission_userId_fkey";

-- DropForeignKey
ALTER TABLE "ModulePermission" DROP CONSTRAINT "ModulePermission_grantedById_fkey";

-- DropIndex
DROP INDEX "User_role_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role";

-- DropTable
DROP TABLE "ModulePermission";

-- DropEnum
DROP TYPE "Role_old";

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Safety nets the Prisma schema cannot express: a member has exactly one role, nobody else has
-- one, and there is at most one default role.
ALTER TABLE "User" ADD CONSTRAINT "User_member_has_role" CHECK (("status" = 'MEMBER') = ("roleId" IS NOT NULL));

CREATE UNIQUE INDEX "Role_single_default" ON "Role" ("isDefault") WHERE "isDefault";
