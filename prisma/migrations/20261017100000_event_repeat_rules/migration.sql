-- Repeat rules.
--
-- A series was one of four shapes (weekly, every two weeks, monthly, and monthly on a day kept in "monthlyDay"):
-- it is now a rule (src/lib/events/repeat.ts), stored in one JSON column "repeat". Every series becomes the rule
-- that gives exactly its dates, so no date moves and no identifier of a calendar file changes:
--
--   WEEKLY                   -> {"freq":"WEEKLY","interval":1}        (the weekday of the first date, as before)
--   BIWEEKLY                 -> {"freq":"WEEKLY","interval":2}
--   MONTHLY, no monthlyDay   -> {"freq":"MONTHLY","interval":1}       (the day of the first date, as before)
--   MONTHLY, monthlyDay = N  -> {"freq":"MONTHLY","interval":1,"monthly":{"kind":"day","day":N}}
--   NONE                     -> NULL
--
-- What a rule leaves out means "like the first date", which is what these series did. The end of a series stays in
-- "recurrenceUntil", untouched. The old columns are then dropped: the rule is the only source of truth.
--
-- Postgres runs this whole file as one transaction: it applies completely or not at all.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "repeat" JSONB;

-- A series with no end date was one date for the application (the end is mandatory): it stays one date.
UPDATE "Event"
SET "repeat" = CASE "recurrence"::text
  WHEN 'WEEKLY' THEN '{"freq":"WEEKLY","interval":1}'::jsonb
  WHEN 'BIWEEKLY' THEN '{"freq":"WEEKLY","interval":2}'::jsonb
  WHEN 'MONTHLY' THEN
    CASE
      WHEN "monthlyDay" IS NULL THEN '{"freq":"MONTHLY","interval":1}'::jsonb
      ELSE jsonb_build_object(
        'freq', 'MONTHLY',
        'interval', 1,
        'monthly', jsonb_build_object('kind', 'day', 'day', "monthlyDay")
      )
    END
END
WHERE "recurrence"::text <> 'NONE' AND "recurrenceUntil" IS NOT NULL;

-- An event that does not repeat has no end date (the old forms never wrote one; nothing read it).
UPDATE "Event" SET "recurrenceUntil" = NULL WHERE "repeat" IS NULL AND "recurrenceUntil" IS NOT NULL;

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "monthlyDay",
DROP COLUMN "recurrence";

-- DropEnum
DROP TYPE "EventRecurrence";

-- A series always has an end (an end date, or the start of its last date), and nothing else has one.
ALTER TABLE "Event" ADD CONSTRAINT "Event_repeat_has_an_end" CHECK (("repeat" IS NULL) = ("recurrenceUntil" IS NULL));
