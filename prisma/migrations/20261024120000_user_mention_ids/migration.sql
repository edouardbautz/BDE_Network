-- How the platform mentions a person on Discord and Slack in the messages it posts for the school's staff.
--
-- Two optional columns the person fills in on their profile (their Discord user id and their Slack member id, which are
-- numbers and codes, never names). Nothing is converted and nobody has any until they say so. They end up in a message that
-- pings, so the database refuses anything but the shape of a real id.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discordUserId" TEXT,
ADD COLUMN     "slackUserId" TEXT;


-- A Discord user id is a snowflake: 17 to 20 digits. A Slack member id starts with U or W and has 8 to 12 capitals or digits.
ALTER TABLE "User" ADD CONSTRAINT "User_discord_user_id_shape" CHECK ("discordUserId" IS NULL OR "discordUserId" ~ '^[0-9]{17,20}$');
ALTER TABLE "User" ADD CONSTRAINT "User_slack_user_id_shape" CHECK ("slackUserId" IS NULL OR "slackUserId" ~ '^[UW][A-Z0-9]{8,12}$');
