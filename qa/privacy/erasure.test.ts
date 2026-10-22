// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDataset } from '../dataset';
import { ADMIN_URL, createMigratedDatabase, type TestDatabase } from '../test-database';

/**
 * What is left of a person once their account is removed, on a real PostgreSQL with the QA dataset (600 events, 300 members, the
 * audit trail of all of it). The privacy policy says: the account is deleted; the audit log and the events keep the **login** as
 * plain text, with no link to an account; nothing else. So, after the deletion, the e-mail address, the full name, the picture,
 * the personal calendar link and the identifier of the account must be **nowhere in the database**, in any column of any table,
 * and the login only in the columns the policy names.
 *
 * The deletion is the one the application does (`user.delete`): what follows from it is the foreign keys of the migrations
 * (`SetNull`, `Cascade`), which is what is held here, on the schema as shipped.
 */

/** Where the policy says the login stays, as plain text. */
const LOGIN_MAY_STAY = new Set([
  'AuditLog.actorLogin',
  'AuditLog.targetLabel',
  'AuditLog.metadata',
  'Event.authorLogin',
  'Event.refusedByLogin',
  'EventAssignee.login',
  'EventOccurrenceAssignee.login',
  'EventCancellation.cancelledByLogin',
]);

describe.skipIf(!ADMIN_URL)('what is left of a person once their account is removed', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    await database.client.query(buildDataset({}).sql);
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  });

  /** Every text-like column of the database, as `Table.column`. */
  async function textColumns(): Promise<{ table: string; column: string }[]> {
    const { rows } = await database.client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
         AND (data_type IN ('text', 'character varying', 'jsonb', 'json') OR data_type = 'ARRAY')
       ORDER BY table_name, column_name`,
    );
    return rows.map((row) => ({ table: String(row.table_name), column: String(row.column_name) }));
  }

  /**
   * The columns in which this value appears, anywhere, as a whole word: a login is not found inside `role-qa-validator`, the
   * identifier of a role that happens to contain it.
   */
  async function whereIs(value: string): Promise<string[]> {
    const found: string[] = [];
    const escaped = value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    for (const { table, column } of await textColumns()) {
      const { rows } = await database.client.query(
        `SELECT count(*)::int AS n FROM "${table}" WHERE "${column}"::text ~ $1`,
        [`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`],
      );
      if (Number(rows[0]?.n) > 0) found.push(`${table}.${column}`);
    }
    return found;
  }

  async function person(login: string) {
    const { rows } = await database.client.query(
      `SELECT "id", "login", "fullName", "email", "photoUrl", "calendarToken" FROM "User" WHERE "login" = $1`,
      [login],
    );
    return rows[0] as {
      id: string;
      login: string;
      fullName: string;
      email: string;
      photoUrl: string | null;
      calendarToken: string | null;
    };
  }

  it('is nothing but the login, in the places the policy names', async () => {
    // somebody with a trace everywhere: events written, dates cancelled, proposals refused, in charge of dates, audit entries
    const who = await person('qa-validator');
    expect(who, 'the validator of the dataset').toBeDefined();
    await database.client.query(
      `UPDATE "User" SET "photoUrl" = 'https://cdn.example/qa-validator.jpg', "calendarToken" = $2 WHERE "id" = $1`,
      [who.id, 'Q'.repeat(43)],
    );
    const before = await person('qa-validator');

    // The sanity of the test: before the removal, each of those values IS somewhere (or the scan proves nothing).
    for (const value of [
      before.email,
      before.fullName,
      before.photoUrl!,
      before.calendarToken!,
      before.id,
    ]) {
      expect(await whereIs(value), `"${value}" before the removal`).not.toEqual([]);
    }
    const traces = await whereIs(before.login);
    expect(traces, 'the login is kept as text in places').toEqual(
      expect.arrayContaining(['Event.authorLogin']),
    );

    await database.client.query(`DELETE FROM "User" WHERE "id" = $1`, [before.id]);

    expect(await person('qa-validator'), 'the account').toBeUndefined();
    for (const [what, value] of [
      ['the e-mail address', before.email],
      ['the full name', before.fullName],
      ['the picture', before.photoUrl!],
      ['the personal calendar link', before.calendarToken!],
    ] as const) {
      expect(await whereIs(value), what).toEqual([]);
    }
    // The identifier of the account stays only as the target of the audit entries about it: it leads to nothing any more, and the
    // entries keep the login as text, as the policy says.
    expect(await whereIs(before.id), 'the identifier of the account').toEqual([
      'AuditLog.targetId',
    ]);

    const left = await whereIs(before.login);
    const unannounced = left.filter((place) => !LOGIN_MAY_STAY.has(place));
    expect(unannounced, 'places where the login stays and the policy does not say so').toEqual([]);
    expect(left.length, 'the login stays somewhere, as the policy says').toBeGreaterThan(0);
  }, 120_000);

  it('leaves no row pointing at an account that does not exist', async () => {
    const { rows } = await database.client.query(
      `SELECT 'AuditLog.actorId' AS at, count(*)::int AS n FROM "AuditLog" a WHERE "actorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = a."actorId")
       UNION ALL SELECT 'Event.authorId', count(*)::int FROM "Event" e WHERE "authorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = e."authorId")
       UNION ALL SELECT 'EventAssignee.userId', count(*)::int FROM "EventAssignee" x WHERE "userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = x."userId")
       UNION ALL SELECT 'EventOccurrenceAssignee.userId', count(*)::int FROM "EventOccurrenceAssignee" x WHERE "userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = x."userId")
       UNION ALL SELECT 'EventCancellation.cancelledById', count(*)::int FROM "EventCancellation" x WHERE "cancelledById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = x."cancelledById")`,
    );
    expect(rows.filter((row) => Number(row.n) > 0)).toEqual([]);
  });
});
