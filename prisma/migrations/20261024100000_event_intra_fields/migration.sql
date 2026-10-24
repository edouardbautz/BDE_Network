-- The fields the school's staff copies into the intra's event form (src/lib/events/intra.ts).
--
-- They are all optional columns: an event written before them keeps every value it had and simply has none of these
-- (the form asks for them at its next edit, and before the event is confirmed, once the platform publishes on the intra).
-- Nothing is converted and nothing is lost. Postgres runs this whole file as one transaction.

-- CreateEnum
CREATE TYPE "IntraAudience" AS ENUM ('STUDENTS', 'PISCINERS', 'BOTH');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "intraAudience" "IntraAudience",
ADD COLUMN     "intraKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "intraKind" TEXT,
ADD COLUMN     "intraMaxPeople" INTEGER,
ADD COLUMN     "intraOrganizerLogin" TEXT,
ADD COLUMN     "intraUnsubscribeHours" INTEGER,
ADD COLUMN     "intraWaitingList" BOOLEAN;


-- The fields come together or not at all: an event with a login for the organizer has a public, a size, a waiting list,
-- a kind, a delay and at least one keyword. (The keywords are a list, never null, so "none" is the empty list.)
ALTER TABLE "Event" ADD CONSTRAINT "Event_intra_complete" CHECK (
  ("intraOrganizerLogin" IS NULL) = ("intraAudience" IS NULL)
  AND ("intraOrganizerLogin" IS NULL) = ("intraMaxPeople" IS NULL)
  AND ("intraOrganizerLogin" IS NULL) = ("intraWaitingList" IS NULL)
  AND ("intraOrganizerLogin" IS NULL) = ("intraKind" IS NULL)
  AND ("intraOrganizerLogin" IS NULL) = ("intraUnsubscribeHours" IS NULL)
  AND ("intraOrganizerLogin" IS NULL) = (COALESCE(cardinality("intraKeywords"), 0) = 0)
);

-- A room for at least one person, and a delay that is not negative.
ALTER TABLE "Event" ADD CONSTRAINT "Event_intra_bounds" CHECK (
  ("intraMaxPeople" IS NULL OR "intraMaxPeople" >= 1) AND ("intraUnsubscribeHours" IS NULL OR "intraUnsubscribeHours" >= 0)
);
