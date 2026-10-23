-- What must be true of the notification templates (see invariants.ts). Kept apart from invariants.sql because a database of
-- an older version, which the update suite looks at after the way back, does not have these tables at all.
SELECT 'a_template_has_its_version_in_the_history' AS invariant, t."id" AS detail
FROM "NotificationTemplate" t
WHERE NOT EXISTS (
  SELECT 1 FROM "NotificationTemplateVersion" v
  WHERE v."type" = t."type" AND v."scope" = t."scope" AND v."version" = t."version"
)
UNION ALL
SELECT 'a_template_is_for_a_channel_its_notification_is_sent_on', "id"
FROM "NotificationTemplate" WHERE "type" = 'memberRemoved' AND "scope" = 'email'
UNION ALL
SELECT 'a_template_author_id_is_the_account_of_the_author_login', t."id"
FROM "NotificationTemplate" t JOIN "User" u ON u."id" = t."updatedById" WHERE u."login" <> t."updatedByLogin"
UNION ALL
SELECT 'a_version_author_id_is_the_account_of_the_author_login', v."id"
FROM "NotificationTemplateVersion" v JOIN "User" u ON u."id" = v."authorId" WHERE u."login" <> v."authorLogin"
UNION ALL
SELECT 'a_version_that_is_not_a_reset_holds_a_template', "id"
FROM "NotificationTemplateVersion" WHERE "content" IS NULL AND "action" <> 'reset'
