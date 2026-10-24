-- Where the publication of an event on the intra stands (src/lib/events/intra-request.ts).
--
-- A new table and nothing else: no existing row is read or changed, and an event written before it has no request (one is
-- made when the event is confirmed, or when someone asks for it). Postgres runs this whole file as one transaction.

-- CreateEnum
CREATE TYPE "IntraRequestStatus" AS ENUM ('PENDING', 'PUBLISHED', 'OUTDATED', 'REFUSED');

-- CreateTable
CREATE TABLE "IntraRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "IntraRequestStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" TEXT NOT NULL,
    "publishedContent" JSONB,
    "publishedAt" TIMESTAMP(3),
    "intraUrl" TEXT,
    "refusalComment" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedByLogin" TEXT NOT NULL,
    "requestedById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredByLogin" TEXT,
    "answeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntraRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntraRequest_eventId_key" ON "IntraRequest"("eventId");

-- CreateIndex
CREATE INDEX "IntraRequest_status_idx" ON "IntraRequest"("status");

-- CreateIndex
CREATE INDEX "IntraRequest_requestedById_idx" ON "IntraRequest"("requestedById");

-- CreateIndex
CREATE INDEX "IntraRequest_answeredById_idx" ON "IntraRequest"("answeredById");

-- AddForeignKey
ALTER TABLE "IntraRequest" ADD CONSTRAINT "IntraRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntraRequest" ADD CONSTRAINT "IntraRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntraRequest" ADD CONSTRAINT "IntraRequest_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- What a row says depends on its state, and the database holds it: a request that waits has nobody who answered and nothing
-- published; a refusal has its comment and its author; a request on the intra (published, or published and since changed)
-- holds the copy of what is there and says who answered and when.
ALTER TABLE "IntraRequest" ADD CONSTRAINT "IntraRequest_state_shape" CHECK (
  CASE "status"
    WHEN 'PENDING' THEN "publishedContent" IS NULL AND "publishedAt" IS NULL AND "intraUrl" IS NULL AND "refusalComment" IS NULL
      AND "answeredAt" IS NULL AND "answeredByLogin" IS NULL
    WHEN 'REFUSED' THEN "publishedContent" IS NULL AND "publishedAt" IS NULL AND "intraUrl" IS NULL AND "refusalComment" IS NOT NULL
      AND "answeredAt" IS NOT NULL AND "answeredByLogin" IS NOT NULL
    ELSE "publishedContent" IS NOT NULL AND "publishedAt" IS NOT NULL AND "refusalComment" IS NULL
      AND "answeredAt" IS NOT NULL AND "answeredByLogin" IS NOT NULL
  END
);

-- The hash is a SHA-256 in hexadecimal, and the link, when there is one, is an https address of the intra (no credentials, no port).
ALTER TABLE "IntraRequest" ADD CONSTRAINT "IntraRequest_hash_shape" CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "IntraRequest" ADD CONSTRAINT "IntraRequest_url_shape" CHECK (
  "intraUrl" IS NULL OR ("intraUrl" ~ '^https://([a-z0-9-]+\.)*intra\.42\.fr(/[^[:space:]<>"]*)?$' AND char_length("intraUrl") <= 300)
);
