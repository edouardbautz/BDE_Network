import { Client } from 'pg';

/**
 * The owner of a journey that sets a webhook up. From 1.6.0 the platform asks everybody, an owner too, for their id on each platform the
 * BDE posts on, and shows nothing else until it is given (docs/architecture.md, "The ids asked of everybody"). So a journey that saves a
 * webhook as the owner and then reads the settings again must be an owner who has answered: that is what these two give and take back.
 * `mention-ids.spec.ts` is the one that plays the step itself, on accounts that have not.
 */

async function sql(query: string, params: unknown[] = []) {
  const db = new Client({ connectionString: process.env.QA_DATABASE_URL });
  await db.connect();
  try {
    await db.query(query, params);
  } finally {
    await db.end();
  }
}

export const giveOwnerIds = () =>
  sql(`UPDATE "User" SET "discordUserId" = $1, "slackUserId" = $2 WHERE login = 'qa-owner'`, [
    '348291047563210241',
    'U04ABCD1234',
  ]);

/** The platform as it came: nobody has given an id. */
export const takeIdsBack = () =>
  sql(`UPDATE "User" SET "discordUserId" = NULL, "slackUserId" = NULL`);
