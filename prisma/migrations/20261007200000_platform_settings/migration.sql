-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "config" JSONB NOT NULL,
    "environment" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT,
    "source" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

