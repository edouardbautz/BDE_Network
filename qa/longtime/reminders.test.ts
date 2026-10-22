// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { buildDataset } from '../dataset';
import { checkInvariants, describeViolations } from '../invariants';
import { ADMIN_URL, createMigratedDatabase, type TestDatabase } from '../test-database';
import { deliveryTick, ticksBetween } from './oracle';

/**
 * A year and a half of the reminder loop on a real PostgreSQL, with the QA dataset (600 events over two school years: series of
 * every repetition, cut in two, cancelled, moved and edited dates, drafts, proposals, refusals). The loop is asked what it would do
 * at each of the ~2400 instants it would look at (every four hours), and what it did is held to what the oracle says
 * (`oracle.ts`: the moment a reminder is due is read from the wall clock with `Intl` alone, across the two changes of clock):
 * every date that must be reminded is, **once**, at the first tick after it is due, and nothing else is.
 *
 * Only the sending is replaced (a recorder); the queries, the series, the claim of a reminder in the database and the rules of
 * which date is reminded are the platform's own. It needs a PostgreSQL server (`MIGRATION_TEST_DATABASE_URL`, the CI's `migrations`
 * job sets it).
 */

const state = vi.hoisted(() => ({
  client: undefined as unknown,
  tick: new Date(0),
  deliveries: [] as { key: string; tick: Date }[],
}));

vi.mock('@/config', () => ({
  getConfig: () => ({
    bde: { timezone: 'Europe/Paris', defaultLocale: 'fr' },
    modules: { enabled: ['events'] },
    events: { categories: [], reminderHour: 18 },
    notifications: { eventReminder: ['discord'] },
  }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, name) => (state.client as Record<string, unknown>)[name as string] },
  ),
}));
vi.mock('@/lib/notifications/recipients', () => ({ emailsOfHolders: vi.fn(async () => []) }));
vi.mock('@/lib/notifications/rich', () => ({
  withRichMessage: vi.fn(async (_event: string, message: unknown) => message),
}));
vi.mock('@/lib/events/discord-embed', () => ({ buildEventEmbed: vi.fn(() => ({})) }));
vi.mock('@/lib/events/email', () => ({ buildEventEmail: vi.fn(() => ({})) }));
vi.mock('@/lib/events/slack-blocks', () => ({ buildEventSlack: vi.fn(() => ({})) }));
vi.mock('@/lib/events/messages', () => ({
  buildReminderMessage: vi.fn((data: unknown) => ({ subject: 'Rappel', body: 'Demain', data })),
}));
vi.mock('@/lib/events/notifications', () => ({
  getTranslate: vi.fn(async () => (key: string) => key),
  repeatSummaryFor: vi.fn(async () => null),
  toNotificationData: vi.fn((event: { id: string }, occurrence: { originalStart: Date }) => ({
    key: `${event.id}|${occurrence.originalStart.toISOString()}`,
  })),
  deliver: vi.fn(async (_event: string, message: { data: { key: string } }) => {
    state.deliveries.push({ key: message.data.key, tick: state.tick });
    return { sent: 1, failed: 0 };
  }),
}));

const { runReminderTick } = await import('@/lib/events/reminders');
const { resolveOccurrences } = await import('@/lib/events/series');

const TIME_ZONE = 'Europe/Paris';
const REMINDER_HOUR = 18;
const FOUR_HOURS = 4 * 3_600_000;
const NOW = new Date('2026-10-16T12:00:00Z');
const DAY = 86_400_000;

/**
 * Four cases the dataset does not hold (it has no date of a confirmed series that is back to draft, and every announcement is
 * older than any reminder), added here so that the rules about them are exercised by something other than a unit test:
 *
 * - A: a confirmed weekly series whose third date (2026-11-18) is back to draft: that date is not reminded, the others are;
 * - B: a draft weekly series whose second date (2026-11-12) was confirmed alone, announced before its reminder was due: only that
 *   date is reminded;
 * - C: a confirmed event announced AFTER its reminder was due (the evening before): no reminder, the members were just told;
 * - D: the same, announced before: reminded.
 */
const FIXTURES = {
  draftedDate: 'lt-a|2026-11-18T19:00:00.000Z',
  keptDate: 'lt-a|2026-11-11T19:00:00.000Z',
  aloneConfirmed: 'lt-b|2026-11-12T19:00:00.000Z',
  aloneNotConfirmed: 'lt-b|2026-11-05T19:00:00.000Z',
  announcedLate: 'lt-c|2026-11-20T10:00:00.000Z',
  announcedInTime: 'lt-d|2026-11-21T10:00:00.000Z',
};

const FIXTURE_SQL = `
INSERT INTO "Event" ("id","title","description","location","categoryKey","status","startsAt","endsAt","repeat","recurrenceUntil","schoolYear","confirmationNotifiedAt","authorLogin","updatedAt")
VALUES
 ('lt-a','Long time A','x','x','soiree','CONFIRMED','2026-11-04T19:00:00Z','2026-11-04T21:00:00Z','{"freq":"WEEKLY","interval":1}','2026-12-09T23:59:00Z','2026-2027','2026-10-01T10:00:00Z','qa-validator',now()),
 ('lt-b','Long time B','x','x','soiree','DRAFT','2026-11-05T19:00:00Z','2026-11-05T21:00:00Z','{"freq":"WEEKLY","interval":1}','2026-11-26T23:59:00Z','2026-2027',NULL,'qa-validator',now()),
 ('lt-c','Long time C','x','x','soiree','CONFIRMED','2026-11-20T10:00:00Z','2026-11-20T12:00:00Z',NULL,NULL,'2026-2027','2026-11-19T20:00:00Z','qa-validator',now()),
 ('lt-d','Long time D','x','x','soiree','CONFIRMED','2026-11-21T10:00:00Z','2026-11-21T12:00:00Z',NULL,NULL,'2026-2027','2026-11-20T10:00:00Z','qa-validator',now());
INSERT INTO "EventOccurrence" ("id","eventId","occurrenceStart","status","confirmationNotifiedAt","updatedAt")
VALUES
 ('lt-a-o','lt-a','2026-11-18T19:00:00Z','DRAFT',NULL,now()),
 ('lt-b-o','lt-b','2026-11-12T19:00:00Z','CONFIRMED','2026-11-11T10:00:00Z',now());
`;

// Three minutes of simulation: the `longtime` job of `qa.yml` (nightly, by hand, or with the label `full-qa`) sets QA_LONGTIME.
describe.skipIf(!ADMIN_URL || !process.env.QA_LONGTIME)(
  'the reminder loop over a year and a half (QA_LONGTIME)',
  () => {
    let database: TestDatabase;
    let prisma: PrismaClient;

    beforeAll(async () => {
      database = await createMigratedDatabase();
      await database.client.query(buildDataset({ now: NOW }).sql);
      await database.client.query(FIXTURE_SQL);
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) });
      state.client = prisma;
    }, 120_000);

    afterAll(async () => {
      await prisma?.$disconnect();
      await database?.drop();
    });

    const claimed = async () =>
      new Set(
        (await prisma.eventReminder.findMany()).map(
          (row) => `${row.eventId}|${row.occurrenceStart.toISOString()}`,
        ),
      );

    /** Every date of every event, with what decides whether it is reminded, as the platform's own series engine resolves it. */
    async function occurrences() {
      const events = await prisma.event.findMany({
        include: {
          assignees: { select: { login: true, user: { select: { fullName: true, email: true } } } },
          cancellations: { select: { occurrenceStart: true } },
          occurrences: {
            include: {
              assignees: {
                select: { login: true, user: { select: { fullName: true, email: true } } },
              },
            },
          },
        },
      });
      return events.flatMap((event) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolveOccurrences(event as any, TIME_ZONE).map((occurrence) => ({
          key: `${event.id}|${occurrence.originalStart.toISOString()}`,
          start: occurrence.start,
          status: occurrence.status,
          cancelled: occurrence.cancelled,
          reminded: occurrence.status === 'CONFIRMED' && !occurrence.cancelled,
          announcedAt: occurrence.announcedAt,
        })),
      );
    }

    /** What the loop must do over these ticks: the key of each reminder, and the tick it goes out at. */
    function expectedOver(
      all: Awaited<ReturnType<typeof occurrences>>,
      ticks: Date[],
      alreadyClaimed: ReadonlySet<string>,
    ) {
      const expected = new Map<string, Date>();
      for (const occurrence of all) {
        if (alreadyClaimed.has(occurrence.key)) continue;
        // the loop looks only at dates that start after the first tick
        if (occurrence.start.getTime() <= (ticks[0]?.getTime() ?? 0)) continue;
        const tick = deliveryTick(occurrence, TIME_ZONE, REMINDER_HOUR, ticks);
        if (tick) expected.set(occurrence.key, tick);
      }
      return expected;
    }

    async function play(ticks: Date[]) {
      state.deliveries.length = 0;
      for (const tick of ticks) {
        state.tick = tick;
        await runReminderTick(tick);
      }
      return [...state.deliveries];
    }

    function judge(
      deliveries: { key: string; tick: Date }[],
      expected: Map<string, Date>,
    ): string[] {
      const problems: string[] = [];
      const seen = new Map<string, Date>();
      for (const { key, tick } of deliveries) {
        if (seen.has(key)) problems.push(`sent twice: ${key}`);
        seen.set(key, tick);
      }
      for (const [key, tick] of expected) {
        const got = seen.get(key);
        if (!got) problems.push(`never sent: ${key} (expected at ${tick.toISOString()})`);
        else if (got.getTime() !== tick.getTime())
          problems.push(`${key}: sent at ${got.toISOString()}, expected at ${tick.toISOString()}`);
      }
      for (const key of seen.keys())
        if (!expected.has(key)) problems.push(`sent but must not be: ${key}`);
      return problems;
    }

    it('reminds every confirmed date exactly once, at the first tick after it is due, and nothing else', async () => {
      const all = await occurrences();
      const before = await claimed();
      const ticks = ticksBetween(
        new Date(NOW.getTime() + 13 * 60_000),
        new Date(NOW.getTime() + 520 * DAY),
        FOUR_HOURS,
      );
      const expected = expectedOver(all, ticks, before);

      // The dataset must hold what the claim is about, or the comparison below proves little.
      const startsInRange = (o: (typeof all)[number]) =>
        o.start > ticks[0]! && o.start < ticks.at(-1)!;
      expect(expected.size, 'reminders expected').toBeGreaterThan(150);
      expect(
        all.filter((o) => o.cancelled && startsInRange(o)).length,
        'cancelled dates in range',
      ).toBeGreaterThan(0);
      expect(
        all.filter((o) => o.status !== 'CONFIRMED' && startsInRange(o)).length,
        'drafts and proposals in range',
      ).toBeGreaterThan(20);
      expect(before.size, 'reminders claimed before the run').toBeGreaterThan(0);

      const deliveries = await play(ticks);
      const problems = judge(deliveries, expected);
      expect(problems.slice(0, 8), `${problems.length} differences`).toEqual([]);

      // The four added cases, from the rules and not from the oracle: what the loop did.
      const sent = new Set(deliveries.map((delivery) => delivery.key));
      expect(sent.has(FIXTURES.keptDate), 'a date of a confirmed series is reminded').toBe(true);
      expect(sent.has(FIXTURES.draftedDate), 'a date back to draft is not').toBe(false);
      expect(
        sent.has(FIXTURES.aloneConfirmed),
        'a date confirmed alone, in a draft series, is',
      ).toBe(true);
      expect(
        sent.has(FIXTURES.aloneNotConfirmed),
        'a date of that draft series that is not, is not',
      ).toBe(false);
      expect(
        sent.has(FIXTURES.announcedLate),
        'an event announced after its reminder was due is not',
      ).toBe(false);
      expect(sent.has(FIXTURES.announcedInTime), 'an event announced before, is').toBe(true);

      // what the loop wrote is what it sent: one claim per message, on top of the claims there were
      expect((await claimed()).size).toBe(before.size + deliveries.length);
      const violations = await checkInvariants(database.client);
      expect(describeViolations(violations)).toBe('');
    }, 900_000);

    it('claims each reminder once when several loops look at the same moment', async () => {
      await prisma.eventReminder.deleteMany();
      const all = await occurrences();
      // the moment with the most reminders due
      const candidates = ticksBetween(
        new Date(NOW.getTime() + 13 * 60_000),
        new Date(NOW.getTime() + 60 * DAY),
        FOUR_HOURS,
      );
      const best = candidates
        .map((tick) => ({ tick, expected: expectedOver(all, [tick], new Set()) }))
        .sort((a, b) => b.expected.size - a.expected.size)[0]!;
      expect(best.expected.size, 'reminders due at that moment').toBeGreaterThan(2);

      state.deliveries.length = 0;
      state.tick = best.tick;
      await Promise.all(Array.from({ length: 6 }, () => runReminderTick(best.tick)));
      const problems = judge([...state.deliveries], best.expected);
      expect(problems.slice(0, 8), `${problems.length} differences`).toEqual([]);
      expect((await claimed()).size).toBe(best.expected.size);
    }, 120_000);

    it('does not remind a date after it has started, and still reminds the ones to come, after three weeks without a loop', async () => {
      await prisma.eventReminder.deleteMany();
      const all = await occurrences();
      const from = new Date(NOW.getTime() + 13 * 60_000);
      const downFrom = new Date(NOW.getTime() + 40 * DAY);
      const downTo = new Date(downFrom.getTime() + 21 * DAY);
      const ticks = ticksBetween(from, new Date(NOW.getTime() + 120 * DAY), FOUR_HOURS).filter(
        (tick) => tick < downFrom || tick >= downTo,
      );
      const expected = expectedOver(all, ticks, new Set());
      const lost = all.filter(
        (o) => o.reminded && o.start > downFrom && o.start < downTo && !expected.has(o.key),
      );
      expect(lost.length, 'dates that started while nothing looked').toBeGreaterThan(5);

      const deliveries = await play(ticks);
      const problems = judge(deliveries, expected);
      expect(problems.slice(0, 8), `${problems.length} differences`).toEqual([]);
      // the ones that were due during the gap and had not started when the loop came back went out at the first tick back
      const backOnline = deliveries.filter(
        (d) =>
          d.tick.getTime() === downTo.getTime() ||
          (d.tick > downTo && d.tick.getTime() - downTo.getTime() < FOUR_HOURS),
      );
      expect(backOnline.length, 'reminders sent when the loop came back').toBeGreaterThan(0);
    }, 600_000);
  },
);
