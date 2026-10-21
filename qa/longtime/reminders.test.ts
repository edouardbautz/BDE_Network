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
    notifications: { eventReminder: 'discord' },
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

describe.skipIf(!ADMIN_URL)('the reminder loop over a year and a half', () => {
  let database: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    await database.client.query(buildDataset({ now: NOW }).sql);
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

  function judge(deliveries: { key: string; tick: Date }[], expected: Map<string, Date>): string[] {
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
});
