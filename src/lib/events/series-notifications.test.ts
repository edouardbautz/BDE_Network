import { notificationsConfig } from '@/test/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What members are told when part of a series is confirmed: one message for the whole confirmed part, one message
 * for a date confirmed on its own, never one per date.
 */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), notifyMany: vi.fn() }));
vi.mock('@/lib/notifications/sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Test' })),
  resolveLogoUrl: vi.fn(async () => undefined),
}));
vi.mock('next-intl', () => ({ createTranslator: vi.fn(() => (key: string) => key) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { updateMany: vi.fn(), findUnique: vi.fn() },
    eventOccurrence: { updateMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { notifyMany } = await import('@/lib/notifications');
const { prisma } = await import('@/lib/prisma');
const { notifyEventConfirmed, notifyOccurrenceConfirmed } = await import('./notifications');

const OCT = (day: number) => new Date(`2099-10-${String(day).padStart(2, '0')}T18:00:00Z`);

const own = (occurrenceStart: Date, values: Record<string, unknown>) => ({
  occurrenceStart,
  title: null,
  description: null,
  location: null,
  categoryKey: null,
  status: null,
  startsAt: null,
  endsAt: null,
  assigneesOverridden: false,
  confirmationNotifiedAt: null,
  updatedAt: new Date('2099-01-02T00:00:00Z'),
  assignees: [],
  ...values,
});

const weekly = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt1',
  title: 'Entraînement',
  description: 'Chaque semaine.',
  location: 'Gymnase',
  categoryKey: 'sport',
  status: 'CONFIRMED' as const,
  startsAt: OCT(5),
  endsAt: new Date('2099-10-05T20:00:00Z'),
  repeat: { freq: 'WEEKLY', interval: 1 },
  recurrenceUntil: new Date('2099-10-31T00:00:00Z'),
  seriesId: null,
  confirmationNotifiedAt: null,
  updatedAt: new Date('2099-01-01T00:00:00Z'),
  cancellations: [],
  occurrences: [],
  assignees: [{ login: 'alice', user: { fullName: 'Alice A' } }],
  ...overrides,
});

const sent = () => vi.mocked(notifyMany).mock.calls.flatMap(([, messages]) => messages);
const calendarOf = (index = 0) => sent()[index]?.email?.ics?.content ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', logoPath: '/logo.svg', timezone: 'Europe/Paris', defaultLocale: 'fr' },
    notifications: notificationsConfig({ eventConfirmed: 'email', eventReminder: 'email' }),
    events: { categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }], reminderHour: 18 },
  } as unknown as ReturnType<typeof getConfig>);
  vi.mocked(notifyMany).mockImplementation(async (_event, messages) =>
    messages.map(() => ({ ok: true as const })),
  );
  vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.eventOccurrence.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { email: 'a@x.fr' },
    { email: 'b@x.fr' },
  ] as never);
});

describe('confirming the following', () => {
  it('is one message for every date, not one per date', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(weekly() as never);
    await notifyEventConfirmed('evt1');

    // One batch, one message per member, each carrying the four dates in its calendar file.
    expect(notifyMany).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(2);
    expect(calendarOf().match(/BEGIN:VEVENT/g)).toHaveLength(4);
  });

  it('leaves out the dates that are still drafts and the cancelled ones, and gives each date its own values', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      weekly({
        cancellations: [{ occurrenceStart: OCT(12) }],
        occurrences: [
          own(OCT(19), { status: 'DRAFT' }),
          own(new Date('2099-10-26T19:00:00Z'), { title: 'Match', location: 'Stade' }),
        ],
      }) as never,
    );
    await notifyEventConfirmed('evt1');

    const content = calendarOf();
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(content).toContain('DTSTART:20991005T180000Z');
    expect(content).toContain('SUMMARY:Match');
    expect(content).toContain('LOCATION:Stade');
    expect(content).not.toContain('DTSTART:20991012T180000Z');
    expect(content).not.toContain('DTSTART:20991019T180000Z');
  });

  it('uses the identifiers of the whole series, even from the second row of a cut series', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      weekly({
        id: 'tail',
        seriesId: 'evt0',
        startsAt: OCT(19),
        endsAt: new Date('2099-10-19T20:00:00Z'),
      }) as never,
    );
    await notifyEventConfirmed('tail');

    expect(calendarOf()).toContain('UID:evt0-20991019T180000Z@bde-network');
    expect(calendarOf()).not.toContain('UID:tail-');
  });

  it('says nothing more when the claim of the row was already taken (a cut series inherits it)', async () => {
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 0 });
    await notifyEventConfirmed('evt1');
    expect(notifyMany).not.toHaveBeenCalled();
  });
});

describe('confirming one date on its own', () => {
  const draftSeries = (extra: Record<string, unknown> = {}) =>
    weekly({
      status: 'DRAFT',
      occurrences: [
        own(OCT(12), {
          status: 'CONFIRMED',
          confirmationNotifiedAt: new Date('2099-01-02T00:00:00Z'),
        }),
      ],
      ...extra,
    });

  it('claims the date on its own row, for a date that is confirmed', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(draftSeries() as never);
    await notifyOccurrenceConfirmed('evt1', OCT(12));

    expect(prisma.eventOccurrence.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: 'evt1',
        occurrenceStart: OCT(12),
        status: 'CONFIRMED',
        confirmationNotifiedAt: null,
      },
      data: { confirmationNotifiedAt: expect.any(Date) },
    });
    expect(prisma.event.updateMany).not.toHaveBeenCalled();
  });

  it('announces that date only: one message, one date in the calendar file, under the series identifier', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(draftSeries() as never);
    await notifyOccurrenceConfirmed('evt1', OCT(12));

    expect(notifyMany).toHaveBeenCalledTimes(1);
    expect(calendarOf().match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(calendarOf()).toContain('UID:evt1-20991012T180000Z@bde-network');
  });

  it('sends nothing when the date was already announced (claim lost)', async () => {
    vi.mocked(prisma.eventOccurrence.updateMany).mockResolvedValue({ count: 0 });
    await notifyOccurrenceConfirmed('evt1', OCT(12));

    expect(notifyMany).not.toHaveBeenCalled();
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('sends nothing for a date that is not confirmed any more, nor for a cancelled one', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      draftSeries({ occurrences: [own(OCT(12), { status: 'DRAFT' })] }) as never,
    );
    await notifyOccurrenceConfirmed('evt1', OCT(12));

    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      draftSeries({ cancellations: [{ occurrenceStart: OCT(12) }] }) as never,
    );
    await notifyOccurrenceConfirmed('evt1', OCT(12));

    expect(notifyMany).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    vi.mocked(prisma.eventOccurrence.updateMany).mockRejectedValue(new Error('db down'));
    await expect(notifyOccurrenceConfirmed('evt1', OCT(12))).resolves.toBeUndefined();

    vi.mocked(prisma.eventOccurrence.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(draftSeries() as never);
    vi.mocked(notifyMany).mockRejectedValue(new Error('SMTP down'));
    await expect(notifyOccurrenceConfirmed('evt1', OCT(12))).resolves.toBeUndefined();
  });
});
