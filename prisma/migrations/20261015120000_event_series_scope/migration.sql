-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "monthlyDay" INTEGER,
ADD COLUMN     "seriesId" TEXT;

-- CreateTable
CREATE TABLE "EventOccurrence" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "categoryKey" TEXT,
    "status" "EventStatus",
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "assigneesOverridden" BOOLEAN NOT NULL DEFAULT false,
    "confirmationNotifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventOccurrenceAssignee" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "userId" TEXT,
    "login" TEXT NOT NULL,

    CONSTRAINT "EventOccurrenceAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventOccurrence_eventId_occurrenceStart_key" ON "EventOccurrence"("eventId", "occurrenceStart");

-- CreateIndex
CREATE INDEX "EventOccurrenceAssignee_userId_idx" ON "EventOccurrenceAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventOccurrenceAssignee_occurrenceId_login_key" ON "EventOccurrenceAssignee"("occurrenceId", "login");

-- AddForeignKey
ALTER TABLE "EventOccurrence" ADD CONSTRAINT "EventOccurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventOccurrenceAssignee" ADD CONSTRAINT "EventOccurrenceAssignee_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "EventOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventOccurrenceAssignee" ADD CONSTRAINT "EventOccurrenceAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A moved date has both its new start and its new end, or neither (the Prisma schema cannot say it).
ALTER TABLE "EventOccurrence" ADD CONSTRAINT "EventOccurrence_moved_both_or_none"
  CHECK (("startsAt" IS NULL) = ("endsAt" IS NULL));
