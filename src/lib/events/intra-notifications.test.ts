import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntraContent } from './intra-request';
import type { IntraOutcome } from './intra-sync';

/**
 * The messages about the publication on the intra: who each goes to, through which room, what it says, and when it is not sent
 * (a request answered or taken back since, a platform that does not publish on the intra, a notification set to no channel). The
 * cards themselves are held by `golden-intra.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  deliver: vi.fn(async () => ({ sent: 1, failed: 0, channels: {} })),
  event: vi.fn(),
  users: vi.fn(),
  audience: vi.fn(),
}));

vi.mock('@/config', () => ({ getConfig: () => mocks.config }));
vi.mock('@/lib/notifications/deliver', () => ({ deliver: mocks.deliver }));
vi.mock('@/lib/public-address', () => ({ registeredAddress: () => 'https://bde.example.fr' }));
vi.mock('@/lib/notifications/templates/resolve', () => ({
  templatesFor: async () => ({
    context: () => ({}),
    build: (_channel: string, make: (context: object) => unknown) => make({}),
  }),
}));
vi.mock('./intra-audience', () => ({ staffAudience: mocks.audience }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { findUnique: mocks.event },
    user: { findUnique: mocks.users },
  },
}));

const {
  announceIntraOutcomes,
  notifyIntraAnswered,
  notifyIntraCancelled,
  notifyIntraChanged,
  notifyIntraRequested,
} = await import('./intra-notifications');

const OCT10 = new Date('2099-10-10T18:00:00Z');

const FIELDS = {
  organizerLogin: 'cmartin',
  audience: 'BOTH' as const,
  maxPeople: 60,
  waitingList: true,
  kind: 'Association',
  unsubscribeHours: 24,
  keywords: ['bde'],
};

const content = (over: Partial<IntraContent> = {}): IntraContent => ({
  title: 'Soirée de rentrée',
  description: 'Venez nombreux',
  location: 'Foyer',
  fields: FIELDS,
  dates: [{ start: OCT10.toISOString(), end: new Date(OCT10.getTime() + 3_600_000).toISOString() }],
  ...over,
});

const storedEvent = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'evt1',
  title: 'Soirée de rentrée',
  description: 'Venez nombreux',
  location: 'Foyer',
  categoryKey: 'soiree',
  status: 'CONFIRMED',
  startsAt: OCT10,
  endsAt: new Date(OCT10.getTime() + 3_600_000),
  repeat: null,
  recurrenceUntil: null,
  schoolYear: '2099-2100',
  updatedAt: new Date('2099-01-01T00:00:00Z'),
  assignees: [],
  cancellations: [],
  occurrences: [],
  authorLogin: 'alice',
  author: { email: 'alice@example.org' },
  intraOrganizerLogin: FIELDS.organizerLogin,
  intraAudience: FIELDS.audience,
  intraMaxPeople: FIELDS.maxPeople,
  intraWaitingList: FIELDS.waitingList,
  intraKind: FIELDS.kind,
  intraUnsubscribeHours: FIELDS.unsubscribeHours,
  intraKeywords: FIELDS.keywords,
  intraRequest: { status, intraUrl: null, refusalComment: null },
  ...extra,
});

function platform(options: { intra?: boolean; channels?: string[] } = {}) {
  const channels = options.channels ?? ['discord', 'email'];
  mocks.config = {
    bde: {
      name: 'BDE Nice',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      accentColor: '#2f5bea',
    },
    modules: { enabled: ['events'] },
    events: { categories: [], intraPublication: options.intra ?? true },
    notifications: Object.fromEntries(
      [
        'memberPending',
        'memberApproved',
        'memberRemoved',
        'eventConfirmed',
        'eventReminder',
        'eventProposed',
        'eventApproved',
        'eventRefused',
        'intraRequested',
        'intraChanged',
        'intraCancelled',
        'intraPublished',
        'intraRefused',
      ].map((key) => [key, channels]),
    ),
  };
}

const delivered = () =>
  mocks.deliver.mock.calls[0] as unknown as [
    string,
    { subject: string; body: string; discord?: unknown },
    string[],
    string,
    string,
  ];

beforeEach(() => {
  vi.clearAllMocks();
  platform();
  mocks.users.mockImplementation(async ({ where }: { where: { login: string } }) => ({
    fullName: where.login === 'alice' ? 'Alice Martin' : `Name of ${where.login}`,
  }));
  mocks.audience.mockResolvedValue({
    emails: ['sophie@example.org', 'marc@example.org'],
    discordIds: ['348291047563210241'],
    slackIds: [],
    fallsBackOnOwners: false,
  });
});

describe('a request is made: the staff is asked', () => {
  it('goes to the staff room and, by e-mail, to the people who hold the right', async () => {
    mocks.event.mockResolvedValue(storedEvent('PENDING'));
    await notifyIntraRequested('evt1', 'alice');

    const [key, message, recipients, prefix, room] = delivered();
    expect(key).toBe('intraRequested');
    expect(room).toBe('staff');
    expect(recipients).toEqual(['sophie@example.org', 'marc@example.org']);
    expect(prefix).toBe('[events]');
    expect(message.subject).toBe('Publication demandée : Soirée de rentrée');
    expect(message.body).toContain('Alice Martin a confirmé un événement');
    // what the staff copies into the form: the fields of the intra
    expect(message.body).toContain("Login de l'organisateur : cmartin");
    // it leads to the staff's page, which the staff can open (not the event's)
    expect(message.body).toContain('https://bde.example.fr/fr/events/intra/evt1');
  });

  it('asks nobody by e-mail when e-mail is not one of the channels (and does not look the people up)', async () => {
    platform({ channels: ['discord'] });
    mocks.event.mockResolvedValue(storedEvent('PENDING'));
    await notifyIntraRequested('evt1', 'alice');
    expect(delivered()[2]).toEqual([]);
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it('sends nothing for a request answered or taken back since, or for an event that is gone', async () => {
    for (const row of [storedEvent('PUBLISHED'), storedEvent('REFUSED'), null]) {
      mocks.event.mockResolvedValue(row);
      await notifyIntraRequested('evt1', 'alice');
    }
    mocks.event.mockResolvedValue(storedEvent('PENDING', { status: 'DRAFT' }));
    await notifyIntraRequested('evt1', 'alice');
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('sends nothing while the platform does not publish on the intra, or when the notification has no channel', async () => {
    mocks.event.mockResolvedValue(storedEvent('PENDING'));
    platform({ intra: false });
    await notifyIntraRequested('evt1', 'alice');
    platform({ channels: [] });
    await notifyIntraRequested('evt1', 'alice');
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('never throws: a failure is logged, and the action that triggered it is not affected', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.event.mockRejectedValue(new Error('database down'));
    await expect(notifyIntraRequested('evt1', 'alice')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('says how many dates a series has, and shows the next one', async () => {
    const week = 7 * 86_400_000;
    mocks.event.mockResolvedValue(
      storedEvent('PENDING', {
        repeat: { freq: 'WEEKLY', interval: 1 },
        recurrenceUntil: new Date(OCT10.getTime() + 2 * week),
      }),
    );
    await notifyIntraRequested('evt1', 'alice');
    expect(delivered()[1].body).toContain('3 dates');
  });
});

describe('an event that is on the intra changes or is taken back: the staff is told', () => {
  const before = content({ title: 'Ancien titre' });
  const outcome = (): Extract<IntraOutcome, { kind: 'changed' }> => ({
    kind: 'changed',
    eventId: 'evt1',
    title: 'Soirée de rentrée',
    before,
    after: content(),
  });

  it('a change carries the old and the new value, and who changed it', async () => {
    await notifyIntraChanged(outcome(), 'alice');
    const [key, message, , , room] = delivered();
    expect(key).toBe('intraChanged');
    expect(room).toBe('staff');
    expect(message.body).toContain('Nom : Ancien titre → Soirée de rentrée');
    expect(message.body).toContain("Un événement qui est sur l'intra a changé");
  });

  it('a withdrawal is told only when the event was on the intra, with its cause and the list as address', async () => {
    const withdrawn = (
      published: IntraContent | null,
      cause: 'draft' | 'deleted' | 'dates' = 'deleted',
    ): Extract<IntraOutcome, { kind: 'withdrawn' }> => ({
      kind: 'withdrawn',
      eventId: 'evt1',
      title: 'Soirée de rentrée',
      cause,
      published,
    });

    await notifyIntraCancelled(withdrawn(null), 'alice');
    expect(mocks.deliver).not.toHaveBeenCalled();

    await notifyIntraCancelled(withdrawn(content(), 'dates'), 'alice');
    const [key, message, , , room] = delivered();
    expect(key).toBe('intraCancelled');
    expect(room).toBe('staff');
    expect(message.body).toContain("Plus aucune date de l'événement n'est publiée.");
    // the event may be gone: the staff is sent to the list, not to a page that no longer exists
    expect(message.body).toContain('https://bde.example.fr/fr/events/intra');
    expect(message.body).not.toContain('/events/intra/evt1');
  });

  it('turns every outcome of a change into its message, in order', async () => {
    mocks.event.mockResolvedValue(storedEvent('PENDING'));
    await announceIntraOutcomes(
      [
        { kind: 'requested', eventId: 'evt1', title: 'T', resent: false },
        outcome(),
        {
          kind: 'withdrawn',
          eventId: 'evt1',
          title: 'T',
          cause: 'draft',
          published: content(),
        },
      ],
      'alice',
    );
    expect((mocks.deliver.mock.calls as unknown as unknown[][]).map((call) => call[0])).toEqual([
      'intraRequested',
      'intraChanged',
      'intraCancelled',
    ]);
  });
});

describe('the staff answers: the author and the BDE room are told', () => {
  it('published: by e-mail to the author, in the BDE room (not the staff’s), with the address on the intra', async () => {
    mocks.event.mockResolvedValue({
      ...storedEvent('PUBLISHED'),
      intraRequest: {
        status: 'PUBLISHED',
        intraUrl: 'https://profile.intra.42.fr/events/12345',
        refusalComment: null,
      },
    });
    await notifyIntraAnswered('published', 'evt1', 'sophie');

    const [key, message, recipients, , room] = delivered();
    expect(key).toBe('intraPublished');
    expect(room).toBe('bde');
    expect(recipients).toEqual(['alice@example.org']);
    expect(message.subject).toBe("Publié sur l'intra : Soirée de rentrée");
    expect(message.body).toContain("Sur l'intra : https://profile.intra.42.fr/events/12345");
    expect(message.body).toContain('https://bde.example.fr/fr/events/evt1');
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it('refused: with the reason of the staff', async () => {
    mocks.event.mockResolvedValue({
      ...storedEvent('REFUSED'),
      intraRequest: {
        status: 'REFUSED',
        intraUrl: null,
        refusalComment: 'La salle est prise ce soir-là.',
      },
    });
    await notifyIntraAnswered('refused', 'evt1', 'sophie');

    const [key, message, recipients, , room] = delivered();
    expect(key).toBe('intraRefused');
    expect(room).toBe('bde');
    expect(recipients).toEqual(['alice@example.org']);
    expect(message.body).toContain('La salle est prise ce soir-là.');
  });

  it('writes to nobody when the author’s account is gone (the BDE room still hears it)', async () => {
    mocks.event.mockResolvedValue({
      ...storedEvent('PUBLISHED'),
      author: null,
      intraRequest: { status: 'PUBLISHED', intraUrl: null, refusalComment: null },
    });
    await notifyIntraAnswered('published', 'evt1', 'sophie');
    expect(delivered()[2]).toEqual([]);
  });

  it('says nothing about an answer that was changed or taken back since', async () => {
    mocks.event.mockResolvedValue(storedEvent('PENDING'));
    await notifyIntraAnswered('published', 'evt1', 'sophie');
    mocks.event.mockResolvedValue({ ...storedEvent('PUBLISHED'), intraRequest: null });
    await notifyIntraAnswered('published', 'evt1', 'sophie');
    mocks.event.mockResolvedValue(null);
    await notifyIntraAnswered('refused', 'evt1', 'sophie');
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
