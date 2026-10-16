// @vitest-environment node
import { createHash } from 'node:crypto';
import { decode } from '@auth/core/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES, buildDataset } from './dataset';
import { checkInvariants, describeViolations } from './invariants';
import { PERSONAS, SESSION_COOKIE, cookieHeaderFor, forgeSessionCookie, persona } from './personas';
import { createRandom } from './prng';
import { ADMIN_URL, createMigratedDatabase, type TestDatabase } from './test-database';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

describe('the generator of random numbers', () => {
  it('gives the same sequence for the same seed, and another for another seed', () => {
    const sequence = (seed: number) => {
      const random = createRandom(seed);
      return Array.from({ length: 5 }, () => random.next());
    };
    expect(sequence(7)).toEqual(sequence(7));
    expect(sequence(7)).not.toEqual(sequence(8));
  });

  it('stays inside what it is asked for', () => {
    const random = createRandom(1);
    for (let round = 0; round < 500; round += 1) {
      const value = random.int(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
    }
    expect(random.sample([1, 2, 3, 4], 9)).toHaveLength(4);
    expect(new Set(random.sample([1, 2, 3, 4], 3)).size).toBe(3);
    expect(() => random.pick([])).toThrow();
  });
});

describe('the personas', () => {
  it('are the nine profiles of the access matrix, with different logins', () => {
    expect(PERSONAS.map((who) => who.key)).toEqual([
      'anonymous',
      'pending',
      'member',
      'proposer',
      'validator',
      'custom',
      'admin',
      'owner',
      'deleted',
    ]);
    const logins = PERSONAS.flatMap((who) => (who.login ? [who.login] : []));
    expect(new Set(logins).size).toBe(logins.length);
  });

  it('forge a session cookie that Auth.js reads back, and the visitor has none', async () => {
    const secret = 'a-secret-for-the-test-that-is-long-enough-0123456789';
    const header = await cookieHeaderFor(persona('member'), secret);
    expect(header?.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    const value = header?.slice(SESSION_COOKIE.length + 1) ?? '';
    expect(await decode({ token: value, secret, salt: SESSION_COOKIE })).toMatchObject({
      login: 'qa-member',
    });
    // another secret does not read it
    await expect(
      decode({ token: value, secret: `${secret}-other`, salt: SESSION_COOKIE }),
    ).rejects.toThrow();
    expect(await cookieHeaderFor(persona('anonymous'), secret)).toBeNull();
    // somebody who was removed still carries a valid cookie: that is the point of the persona
    expect(await cookieHeaderFor(persona('deleted'), secret)).not.toBeNull();
    expect(await forgeSessionCookie('x', secret)).not.toBe(await forgeSessionCookie('y', secret));
  });
});

describe('the dataset', () => {
  const dataset = buildDataset();

  it('is the same every time, byte for byte, and another one for another seed', () => {
    expect(digest(buildDataset().sql)).toBe(digest(dataset.sql));
    expect(digest(buildDataset({ seed: 1 }).sql)).not.toBe(digest(dataset.sql));
  });

  it('is the size of a BDE that has run for two years', () => {
    expect(dataset.stats.User).toBeGreaterThanOrEqual(300);
    expect(dataset.stats.Event).toBeGreaterThanOrEqual(550);
    expect(dataset.stats.AuditLog).toBeGreaterThan(900);
    expect(dataset.sql.length).toBeGreaterThan(200_000);
  });

  it('holds every kind of thing the platform has to cope with', () => {
    const sql = dataset.sql;
    expect(dataset.stats.EventAssignee).toBeGreaterThan(100);
    expect(dataset.stats.EventCancellation).toBeGreaterThan(20);
    expect(dataset.stats.EventOccurrence).toBeGreaterThan(20);
    expect(dataset.stats.EventReminder).toBeGreaterThan(100);
    for (const status of [
      "'PROPOSED'",
      "'CONFIRMED'",
      "'DRAFT'",
      "'OWNER'",
      "'PENDING'",
      "'MEMBER'",
    ]) {
      expect(sql).toContain(status);
    }
    // a refused proposal, a series cut in two, a series with a rule of every frequency
    expect(sql).toMatch(/'event\.refuse'/);
    expect(sql).toMatch(/'qa-evt-\d{4}-b'/);
    for (const frequency of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
      expect(sql).toContain(`"freq":"${frequency}"`);
  });

  it('creates the account of every persona that has one, and the roles they hold', () => {
    for (const who of PERSONAS) {
      if (!who.login || !who.status) continue;
      expect(dataset.sql).toContain(`'${who.login}'`);
      if (who.role && !who.role.builtin) expect(dataset.sql).toContain(`'${who.role.id}'`);
    }
    // the removed member has a cookie but no account
    expect(dataset.sql).not.toContain("'qa-deleted'");
  });

  it('has the fixtures the suites name, with the ids they name them by, even in a small dataset', () => {
    for (const sql of [
      dataset.sql,
      buildDataset({ members: 0, eventsPerYear: 0, schoolYears: 1 }).sql,
    ]) {
      for (const account of Object.values(FIXTURES.accounts))
        expect(sql).toContain(`'${account.id}'`);
      for (const id of Object.values(FIXTURES.events)) expect(sql).toContain(`'${id}'`);
      expect(sql).toContain(`'${FIXTURES.spareRole}'`);
    }
  });

  it('writes what is typed with an apostrophe as SQL can read it', () => {
    expect(dataset.sql).toContain("N''Diaye");
  });

  it('can be made smaller, for the suites that want a quick platform', () => {
    const small = buildDataset({ members: 20, eventsPerYear: 15, schoolYears: 1 });
    expect(small.stats.User).toBe(30); // 7 personas that have an account, 3 fixture accounts, and 20 members
    expect(small.stats.Event).toBeLessThan(dataset.stats.Event ?? 0);
  });
});

// ---- against a real PostgreSQL ----------------------------------------------------------------------------------------

const describeWithDatabase = ADMIN_URL ? describe : describe.skip;

describeWithDatabase('the dataset in a real database, and the invariants over it', () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedDatabase();
    // the migrations make the roles of a fresh install; the dataset adds its own
    await database.client.query(buildDataset().sql);
  }, 120_000);
  afterAll(async () => {
    await database?.drop();
  });

  it('is accepted by every constraint of the database', async () => {
    const { rows } = await database.client.query('SELECT count(*)::int AS events FROM "Event"');
    expect(rows[0]?.events).toBeGreaterThanOrEqual(550);
  });

  it('satisfies every invariant', async () => {
    const violations = await checkInvariants(database.client);
    expect(describeViolations(violations)).toBe('');
  });

  describe('and the invariants see what is wrong', () => {
    /** Corrupts the database inside a transaction, says what the invariants find, and puts everything back. */
    async function corrupt(statement: string): Promise<string[]> {
      const { client } = database;
      await client.query('BEGIN');
      try {
        await client.query(statement);
        const violations = await checkInvariants(client);
        return [...new Set(violations.map((violation) => violation.invariant))];
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it.each([
      [
        'an event that ends before it starts',
        `UPDATE "Event" SET "endsAt" = "startsAt" - interval '1 hour' WHERE id = 'qa-evt-0001'`,
        'event_ends_after_it_starts',
      ],
      [
        'a school year that is not the one of the start',
        `UPDATE "Event" SET "schoolYear" = '1999-2000' WHERE id = 'qa-evt-0001'`,
        'school_year_is_the_one_of_the_start',
      ],
      [
        'a rule that is not one',
        `UPDATE "Event" SET "repeat" = '{"freq":"HOURLY","interval":1}', "recurrenceUntil" = "startsAt" + interval '3 days' WHERE id = 'qa-evt-0001'`,
        'repeat_is_a_rule',
      ],
      [
        'an interval of 0',
        `UPDATE "Event" SET "repeat" = '{"freq":"DAILY","interval":0}', "recurrenceUntil" = "startsAt" + interval '3 days' WHERE id = 'qa-evt-0001'`,
        'repeat_is_a_rule',
      ],
      [
        'a proposal that has no date',
        `UPDATE "Event" SET "status" = 'PROPOSED', "proposedAt" = NULL WHERE id = 'qa-evt-0001'`,
        'a_proposal_has_its_date',
      ],
      [
        'a cut series whose first row is gone',
        `UPDATE "Event" SET "seriesId" = 'nowhere' WHERE id = 'qa-evt-0001'`,
        'the_row_a_series_was_cut_from_exists',
      ],
      [
        'a feed token of the wrong shape',
        `UPDATE "User" SET "calendarToken" = 'short' WHERE login = 'qa-member'`,
        'calendar_token_is_43_url_safe_characters',
      ],
      [
        'a webhook address in the audit trail',
        `UPDATE "AuditLog" SET "metadata" = '{"url":"https://discord.com/api/webhooks/1/abc"}' WHERE id = (SELECT min(id) FROM "AuditLog")`,
        'no_secret_in_the_audit_trail',
      ],
      [
        'an audit entry that names nobody',
        `UPDATE "AuditLog" SET "actorLogin" = '' WHERE id = (SELECT min(id) FROM "AuditLog")`,
        'an_audit_entry_names_its_author_and_its_action',
      ],
      [
        'a member in charge under another login',
        `UPDATE "EventAssignee" SET "login" = 'someone-else' WHERE id = (SELECT min(id) FROM "EventAssignee" WHERE "userId" IS NOT NULL)`,
        'a_member_in_charge_is_the_account_of_that_login',
      ],
      [
        'a second default role',
        `UPDATE "Role" SET "isDefault" = TRUE WHERE id = 'role-admin'`,
        'one_default_role',
      ],
    ])('%s', async (_what, statement, invariant) => {
      // (some of these are also refused by a constraint: then the statement itself throws, which is as good)
      try {
        expect(await corrupt(statement)).toContain(invariant);
      } catch (error) {
        expect(String(error)).toMatch(/violates|duplicate key|check constraint/i);
      }
    });

    it('a date that the series does not have, in a cancellation, a date of its own and a reminder', async () => {
      const found = await corrupt(`
        INSERT INTO "EventCancellation" (id, "eventId", "occurrenceStart", "cancelledByLogin")
          SELECT 'bad-can', id, "startsAt" + interval '1 minute', 'x' FROM "Event" WHERE "repeat" IS NOT NULL ORDER BY id LIMIT 1;
        INSERT INTO "EventReminder" (id, "eventId", "occurrenceStart")
          SELECT 'bad-rem', id, "startsAt" + interval '1 minute' FROM "Event" WHERE "repeat" IS NOT NULL ORDER BY id LIMIT 1;
        INSERT INTO "EventOccurrence" (id, "eventId", "occurrenceStart", "title", "updatedAt")
          SELECT 'bad-occ', id, "startsAt" + interval '1 minute', 't', now() FROM "Event" WHERE "repeat" IS NOT NULL ORDER BY id LIMIT 1;`);
      expect(found).toEqual(
        expect.arrayContaining([
          'a_cancelled_date_is_a_date_of_its_series',
          'a_reminded_date_is_a_date_of_its_series',
          'a_date_of_its_own_is_a_date_of_its_series',
        ]),
      );
    });

    it('a row about a date, on an event that does not repeat, for another date than its own', async () => {
      const found = await corrupt(`
        INSERT INTO "EventReminder" (id, "eventId", "occurrenceStart")
          SELECT 'bad-rem2', id, "startsAt" + interval '1 day' FROM "Event" WHERE "repeat" IS NULL ORDER BY id LIMIT 1`);
      expect(found).toContain('an_event_that_does_not_repeat_has_no_date_of_its_own_but_its_own');
    });
  });
});
