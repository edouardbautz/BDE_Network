-- CreateTable
CREATE TABLE "BdeCalendarFeed" (
    "id" TEXT NOT NULL DEFAULT 'bde',
    "token" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BdeCalendarFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BdeCalendarFeed_token_key" ON "BdeCalendarFeed"("token");

