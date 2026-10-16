-- What must be true of the database of a BDE after any scenario: nothing lost, nothing corrupt, nothing half-written.
-- One row per violation: (invariant, detail). An empty result is a healthy database. Run by qa/invariants.ts, which
-- sets `qa.tz` (the BDE's time zone) first; the checks that need the series engine are in that file, not here.

-- ---- accounts and roles ----
SELECT 'one_default_role' AS invariant, count(*)::text AS detail
FROM "Role" WHERE "isDefault" HAVING count(*) <> 1
UNION ALL
SELECT 'member_has_a_role_and_nobody_else_does', id
FROM "User" WHERE ("status" = 'MEMBER') <> ("roleId" IS NOT NULL)
UNION ALL
SELECT 'calendar_token_is_43_url_safe_characters', id
FROM "User" WHERE "calendarToken" IS NOT NULL AND "calendarToken" !~ '^[A-Za-z0-9_-]{43}$'
UNION ALL
SELECT 'bde_feed_token_is_43_url_safe_characters', id
FROM "BdeCalendarFeed" WHERE "token" IS NOT NULL AND "token" !~ '^[A-Za-z0-9_-]{43}$'
UNION ALL
SELECT 'a_pending_account_has_no_feed_token', id
FROM "User" WHERE "status" = 'PENDING' AND "calendarToken" IS NOT NULL

-- ---- settings ----
UNION ALL
SELECT 'at_most_one_settings_row_and_it_is_called_platform', id
FROM "PlatformSettings" WHERE "id" <> 'platform'
UNION ALL
SELECT 'secrets_are_sealed', id
FROM "PlatformSettings" WHERE "secrets" IS NOT NULL AND "secrets" !~ '^v1\.'

-- ---- events ----
UNION ALL
SELECT 'event_has_a_title_and_a_category', id
FROM "Event" WHERE btrim("title") = '' OR btrim("categoryKey") = ''
UNION ALL
SELECT 'event_ends_after_it_starts', id
FROM "Event" WHERE "endsAt" <= "startsAt"
UNION ALL
SELECT 'series_ends_after_it_starts', id
FROM "Event" WHERE "recurrenceUntil" IS NOT NULL AND "recurrenceUntil" < "startsAt"
UNION ALL
SELECT 'repeat_and_its_end_come_together', id
FROM "Event" WHERE ("repeat" IS NULL) <> ("recurrenceUntil" IS NULL)
UNION ALL
SELECT 'repeat_is_a_rule', id
FROM "Event"
WHERE "repeat" IS NOT NULL AND NOT (
  jsonb_typeof("repeat") = 'object'
  AND "repeat"->>'freq' IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')
  AND jsonb_typeof("repeat"->'interval') = 'number'
  AND ("repeat"->>'interval')::numeric BETWEEN 1 AND 99
  AND ("repeat"->>'interval')::numeric = trunc(("repeat"->>'interval')::numeric)
  AND (NOT ("repeat" ? 'count') OR (
    jsonb_typeof("repeat"->'count') = 'number' AND ("repeat"->>'count')::numeric BETWEEN 1 AND 400
  ))
)
UNION ALL
SELECT 'school_year_is_the_one_of_the_start', id
FROM "Event"
WHERE "schoolYear" <> (
  SELECT CASE WHEN extract(month FROM local) >= 9
    THEN extract(year FROM local)::int || '-' || (extract(year FROM local)::int + 1)
    ELSE (extract(year FROM local)::int - 1) || '-' || extract(year FROM local)::int END
  FROM (SELECT ("Event"."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('qa.tz') AS local) AS converted
)
UNION ALL
-- (proposedAt is never cleared: a withdrawn or refused proposal keeps the date it was made)
SELECT 'a_proposal_has_its_date', id
FROM "Event" WHERE "status" = 'PROPOSED' AND "proposedAt" IS NULL
UNION ALL
SELECT 'a_refusal_follows_a_proposal', id
FROM "Event" WHERE "refusedAt" IS NOT NULL AND "proposedAt" IS NULL
UNION ALL
SELECT 'a_refusal_is_a_draft_with_its_three_fields', id
FROM "Event"
WHERE (("refusalComment" IS NULL) <> ("refusedByLogin" IS NULL))
   OR (("refusalComment" IS NULL) <> ("refusedAt" IS NULL))
   OR ("refusalComment" IS NOT NULL AND "status" <> 'DRAFT')
UNION ALL
SELECT 'the_row_a_series_was_cut_from_exists', id
FROM "Event" e WHERE "seriesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Event" first WHERE first."id" = e."seriesId")
UNION ALL
SELECT 'a_series_is_not_cut_from_itself', id
FROM "Event" WHERE "seriesId" = "id"
UNION ALL
SELECT 'an_event_that_does_not_repeat_has_no_date_of_its_own_but_its_own', e."id"
FROM "Event" e
WHERE e."repeat" IS NULL AND (
  EXISTS (SELECT 1 FROM "EventOccurrence" o WHERE o."eventId" = e."id" AND o."occurrenceStart" <> e."startsAt")
  OR EXISTS (SELECT 1 FROM "EventCancellation" c WHERE c."eventId" = e."id" AND c."occurrenceStart" <> e."startsAt")
  OR EXISTS (SELECT 1 FROM "EventReminder" r WHERE r."eventId" = e."id" AND r."occurrenceStart" <> e."startsAt")
)

-- ---- dates of a series ----
UNION ALL
SELECT 'a_moved_date_has_both_its_ends_and_ends_after_it_starts', id
FROM "EventOccurrence"
WHERE (("startsAt" IS NULL) <> ("endsAt" IS NULL)) OR ("startsAt" IS NOT NULL AND "endsAt" <= "startsAt")
UNION ALL
SELECT 'a_date_of_its_own_has_something_of_its_own_or_a_claimed_notice', id
FROM "EventOccurrence" o
WHERE "title" IS NULL AND "description" IS NULL AND "location" IS NULL AND "categoryKey" IS NULL
  AND "status" IS NULL AND "startsAt" IS NULL AND NOT "assigneesOverridden" AND "confirmationNotifiedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "EventOccurrenceAssignee" a WHERE a."occurrenceId" = o."id")
UNION ALL
SELECT 'a_member_in_charge_is_the_account_of_that_login', a."id"
FROM "EventAssignee" a JOIN "User" u ON u."id" = a."userId" WHERE u."login" <> a."login"
UNION ALL
SELECT 'a_member_in_charge_of_a_date_is_the_account_of_that_login', a."id"
FROM "EventOccurrenceAssignee" a JOIN "User" u ON u."id" = a."userId" WHERE u."login" <> a."login"
UNION ALL
SELECT 'an_author_id_is_the_account_of_the_author_login', e."id"
FROM "Event" e JOIN "User" u ON u."id" = e."authorId" WHERE u."login" <> e."authorLogin"

-- ---- the audit trail ----
UNION ALL
SELECT 'an_audit_entry_names_its_author_and_its_action', id
FROM "AuditLog" WHERE btrim("actorLogin") = '' OR btrim("action") = '' OR btrim("targetType") = ''
UNION ALL
SELECT 'an_audit_actor_id_is_the_account_of_the_actor_login', a."id"
FROM "AuditLog" a JOIN "User" u ON u."id" = a."actorId" WHERE u."login" <> a."actorLogin" AND a."actorLogin" <> 'system'
UNION ALL
SELECT 'no_secret_in_the_audit_trail', id
FROM "AuditLog"
WHERE coalesce("metadata"::text, '') || coalesce("targetLabel", '') ~* '(discord(app)?\.com/api/webhooks/|hooks\.slack\.com/services/|s-s4t2ud-|s-s4t2af-|v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.)'
