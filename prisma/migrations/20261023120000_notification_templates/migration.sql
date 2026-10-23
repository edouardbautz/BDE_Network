-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "basedOnRevision" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByLogin" TEXT NOT NULL,
    "updatedById" TEXT,
    "lastFallbackAt" TIMESTAMP(3),
    "lastFallbackReason" TEXT,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplateVersion" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB,
    "basedOnRevision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMention" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdByLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_type_scope_key" ON "NotificationTemplate"("type", "scope");

-- CreateIndex
CREATE INDEX "NotificationTemplateVersion_type_scope_createdAt_idx" ON "NotificationTemplateVersion"("type", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationTemplateVersion_authorId_idx" ON "NotificationTemplateVersion"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplateVersion_type_scope_version_key" ON "NotificationTemplateVersion"("type", "scope", "version");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMention_platform_key_key" ON "NotificationMention"("platform", "key");

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplateVersion" ADD CONSTRAINT "NotificationTemplateVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What Prisma cannot express: the values these text columns may hold.
ALTER TABLE "NotificationTemplate"
    ADD CONSTRAINT "NotificationTemplate_scope_known" CHECK ("scope" IN ('all', 'discord', 'slack', 'email')),
    ADD CONSTRAINT "NotificationTemplate_version_positive" CHECK ("version" >= 1);

ALTER TABLE "NotificationTemplateVersion"
    ADD CONSTRAINT "NotificationTemplateVersion_scope_known" CHECK ("scope" IN ('all', 'discord', 'slack', 'email')),
    ADD CONSTRAINT "NotificationTemplateVersion_version_positive" CHECK ("version" >= 1),
    ADD CONSTRAINT "NotificationTemplateVersion_action_known" CHECK ("action" ~ '^(save|reset|restore:[0-9]+)$');

ALTER TABLE "NotificationMention"
    ADD CONSTRAINT "NotificationMention_platform_known" CHECK ("platform" IN ('discord', 'slack')),
    ADD CONSTRAINT "NotificationMention_kind_for_platform" CHECK (
        ("platform" = 'discord' AND "kind" IN ('role', 'user')) OR
        ("platform" = 'slack' AND "kind" IN ('group', 'user'))
    ),
    ADD CONSTRAINT "NotificationMention_key_shape" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("key") <= 40),
    ADD CONSTRAINT "NotificationMention_id_shape" CHECK (
        ("platform" = 'discord' AND "externalId" ~ '^[0-9]{17,20}$') OR
        ("platform" = 'slack' AND "externalId" ~ '^[UWS][A-Z0-9]{8,14}$')
    );
