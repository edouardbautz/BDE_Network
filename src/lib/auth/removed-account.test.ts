// @vitest-environment node
import { encode } from '@auth/core/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the "removed member" hole: removing a member deletes
 * their User row, but the cookie in their browser stays cryptographically
 * valid for up to 30 days. It used to read as "signed in with no id and no
 * role", which counted as an approved member and — because Prisma drops a
 * filter set to `undefined` — as holding every module permission of every
 * other member: drafts readable, events created and confirmed, and the RGPD
 * export querying without an owner.
 *
 * Everything between the cookie and the data is real here: the NextAuth
 * configuration (jwt + session callbacks, decoding a genuine signed cookie),
 * getEffectiveSession, the events access rules, the route handlers and the
 * server actions. Only the database is faked, and it deliberately behaves like
 * Prisma: a filter whose value is `undefined` is ignored.
 */

const { RedirectSignal, db, SECRET } = vi.hoisted(() => {
  const SECRET = 'removed-account-test-secret-0123456789';
  process.env.AUTH_SECRET = SECRET;

  class RedirectSignal extends Error {}

  type Row = Record<string, unknown>;
  const db = {
    /** The Cookie header the next request carries. */
    cookie: '',
    users: [] as Row[],
    roles: [] as Row[],
    events: [] as Row[],
    audit: [] as Row[],
  };
  return { RedirectSignal, db, SECRET };
});

vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    bde: { name: 'BDE Test', timezone: 'Europe/Paris' },
    modules: { enabled: ['events'] },
    events: {
      categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }],
      reminderHour: 18,
    },
  })),
}));

vi.mock('next/headers', () => ({
  // Next always sets x-forwarded-proto; without it Auth.js assumes https and
  // looks for the "__Secure-" cookie name instead of the one forged below.
  headers: vi.fn(
    async () =>
      new Headers({ cookie: db.cookie, host: 'localhost:3000', 'x-forwarded-proto': 'http' }),
  ),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw new RedirectSignal();
  }),
}));

vi.mock('@/lib/prisma', () => {
  type Row = Record<string, unknown>;

  /** Prisma semantics: a filter whose value is `undefined` is not applied. */
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(
      ([key, value]) =>
        value === undefined || (typeof value === 'object' && value !== null) || row[key] === value,
    );
  const requireFilter = (where: Row) => {
    if (!Object.values(where).some((value) => value !== undefined)) {
      throw new Error('PrismaClientValidationError: needs at least one unique field');
    }
  };
  /** Prisma returns the role with the user when the query asks for it. */
  const withRole = (row: Row | undefined, args: { include?: Row; select?: Row } = {}) => {
    if (!row) return null;
    const wanted = args.include?.role ?? args.select?.role;
    return wanted ? { ...row, role: db.roles.find((role) => role.id === row.roleId) ?? null } : row;
  };
  const many =
    (rows: Row[]) =>
    async ({ where }: { where?: Row }) =>
      rows.filter((row) => matches(row, where)).map((row) => ({ ...row }));

  return {
    prisma: {
      user: {
        findUnique: vi.fn(async (args: { where: Row; include?: Row; select?: Row }) => {
          requireFilter(args.where);
          return withRole(
            db.users.find((row) => matches(row, args.where)),
            args,
          );
        }),
        findUniqueOrThrow: vi.fn(async (args: { where: Row; include?: Row; select?: Row }) => {
          requireFilter(args.where);
          const row = withRole(
            db.users.find((candidate) => matches(candidate, args.where)),
            args,
          );
          if (!row) throw new Error('PrismaClientKnownRequestError: not found');
          return row;
        }),
        findMany: vi.fn(many(db.users)),
      },
      auditLog: {
        findMany: vi.fn(many(db.audit)),
        create: vi.fn(async ({ data }: { data: Row }) => {
          if (typeof data.actorLogin !== 'string') {
            throw new Error('PrismaClientValidationError: Argument `actorLogin` is missing');
          }
          db.audit.push(data);
          return data;
        }),
      },
      event: {
        findMany: vi.fn(async ({ where }: { where?: Row }) =>
          db.events
            .filter((row) => matches(row, where))
            .map((row) => ({ ...row, assignees: [], cancellations: [] })),
        ),
        findUnique: vi.fn(async ({ where }: { where: Row }) => {
          requireFilter(where);
          const row = db.events.find((candidate) => matches(candidate, where));
          return row ? { ...row, assignees: [], cancellations: [] } : null;
        }),
        create: vi.fn(async ({ data }: { data: Row }) => {
          // The nested `assignees` relation is not a column of the row.
          const row = { id: 'evt_new', updatedAt: new Date(), ...data, assignees: undefined };
          db.events.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
          const row = db.events.find((candidate) => matches(candidate, where));
          if (!row) throw new Error('PrismaClientKnownRequestError: not found');
          Object.assign(row, data);
          return { ...row };
        }),
      },
      eventAssignee: { findMany: vi.fn(async () => []) },
    },
  };
});

const { auth } = await import('@/lib/auth');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { getEventsAccess } = await import('@/lib/events/access');
const { prisma } = await import('@/lib/prisma');
const { GET: downloadIcs } = await import('@/app/api/events/[id]/ics/route');
const { GET: exportMyData } = await import('@/app/api/me/export/route');
const { GET: subscriptionFeed } = await import('@/app/api/calendar/[token]/route');
const { createEvent, setEventStatus } = await import('@/app/[locale]/(app)/events/actions');

const FEED_TOKEN = 'F'.repeat(43);
const AT = new Date('2026-10-01T10:00:00Z');

function user(login: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `u_${login}`,
    login,
    fullName: `${login} Name`,
    email: `${login}@example.org`,
    photoUrl: null,
    campus: 'Paris',
    status: 'MEMBER',
    roleId: 'role-member',
    calendarToken: null,
    createdAt: AT,
    updatedAt: AT,
    lastLoginAt: AT,
    ...overrides,
  };
}

function event(id: string, title: string, status: 'DRAFT' | 'CONFIRMED') {
  return {
    id,
    title,
    description: 'Description',
    location: 'Salle B',
    categoryKey: 'soiree',
    status,
    startsAt: new Date('2026-10-10T18:00:00Z'),
    endsAt: new Date('2026-10-10T20:00:00Z'),
    recurrence: 'NONE',
    recurrenceUntil: null,
    schoolYear: '2026-2027',
    updatedAt: AT,
    authorLogin: 'bob',
    authorId: 'u_bob',
  };
}

/** A genuinely signed session cookie, as the browser of `login` would send it. */
async function signInAs(login: string) {
  const token = await encode({
    token: { login, name: login, email: `${login}@example.org`, sub: login },
    secret: SECRET,
    salt: 'authjs.session-token',
    maxAge: 3600,
  });
  db.cookie = `authjs.session-token=${token}`;
}

const icsOf = (id: string) =>
  downloadIcs(new Request(`http://localhost/api/events/${id}/ics`), {
    params: Promise.resolve({ id }),
  });

function eventForm() {
  const data = new FormData();
  const values = {
    title: 'Soirée de rentrée',
    description: 'Venez nombreux',
    location: 'Salle B',
    categoryKey: 'soiree',
    startsAt: '2026-10-10T20:00',
    endsAt: '2026-10-11T02:00',
    recurrence: 'NONE',
    recurrenceUntil: '',
    status: 'DRAFT',
  };
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.cookie = '';
  // alice has the default "Membre" role (can view events); bob's role also manages them.
  db.roles.splice(
    0,
    db.roles.length,
    { id: 'role-member', name: 'Membre', permissions: ['events.view'], allPermissions: false },
    {
      id: 'role-events',
      name: 'Resp. événements',
      permissions: ['events.view', 'events.manage'],
      allPermissions: false,
    },
  );
  db.users.splice(
    0,
    db.users.length,
    user('alice', { calendarToken: FEED_TOKEN }),
    user('bob', { roleId: 'role-events' }),
  );
  db.events.splice(
    0,
    db.events.length,
    event('evt_draft', 'SECRET DRAFT', 'DRAFT'),
    event('evt_public', 'Public party', 'CONFIRMED'),
  );
  db.audit.splice(0, db.audit.length, {
    actorLogin: 'bob',
    actorId: 'u_bob',
    action: 'event.create',
    targetType: 'Event',
    targetLabel: 'Public party',
    createdAt: AT,
  });
});

describe('a member removed from the BDE, with a cookie that is still valid', () => {
  beforeEach(async () => {
    // "ghost" was a member, then an admin removed them: their row is gone.
    await signInAs('ghost');
  });

  it('is not signed in at all', async () => {
    await expect(auth()).resolves.toBeNull();
    await expect(getEffectiveSession()).resolves.toBeNull();
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('cannot read a draft', async () => {
    const response = await icsOf('evt_draft');

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('SECRET DRAFT');
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('cannot create an event, and nothing is written or audited', async () => {
    await expect(createEvent({}, eventForm())).rejects.toThrow('Forbidden');

    expect(prisma.event.create).not.toHaveBeenCalled();
    expect(db.events).toHaveLength(2);
    expect(db.audit).toHaveLength(1);
  });

  it('cannot confirm a draft, and nothing is written or audited', async () => {
    await expect(setEventStatus('evt_draft', 'CONFIRMED')).rejects.toThrow('Forbidden');

    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(db.events.find((row) => row.id === 'evt_draft')?.status).toBe('DRAFT');
    expect(db.audit).toHaveLength(1);
  });

  it('gets no RGPD export, and no query runs without an owner', async () => {
    const response = await exportMyData();

    expect(response.status).toBe(401);
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("cannot use the removed member's subscription link either (the row, and its token, are gone)", async () => {
    const response = await subscriptionFeed(new Request('http://localhost/api/calendar/x'), {
      params: Promise.resolve({ token: 'G'.repeat(43) }),
    });

    expect(response.status).toBe(404);
  });
});

/**
 * Controls: the same harness lets legitimate accounts through. Without these,
 * the tests above would also pass if everything were refused for everyone.
 */
describe('accounts that still exist', () => {
  it('a plain member reads confirmed events, never drafts, and cannot write', async () => {
    await signInAs('alice');

    await expect(getEffectiveSession()).resolves.toMatchObject({
      user: { id: 'u_alice', login: 'alice', status: 'MEMBER', roleName: 'Membre' },
    });
    expect((await icsOf('evt_public')).status).toBe(200);
    expect((await icsOf('evt_draft')).status).toBe(404);
    await expect(setEventStatus('evt_draft', 'CONFIRMED')).rejects.toThrow('Forbidden');
    await expect(createEvent({}, eventForm())).rejects.toThrow('Forbidden');
    expect(db.events.find((row) => row.id === 'evt_draft')?.status).toBe('DRAFT');
  });

  it("a plain member's export holds only their own data", async () => {
    await signInAs('alice');

    const response = await exportMyData();
    const body = JSON.parse(await response.text());

    expect(response.status).toBe(200);
    expect(body.user.login).toBe('alice');
    expect(body.auditLogActions).toEqual([]);
    expect(body.events.authored).toEqual([]);
    expect(body.user.role).toBe('Membre');
  });

  it('a member with the events permission reads drafts, creates and confirms, with an audit trail', async () => {
    await signInAs('bob');

    const draft = await icsOf('evt_draft');
    expect(draft.status).toBe(200);
    expect(await draft.text()).toContain('SECRET DRAFT');

    await expect(createEvent({}, eventForm())).rejects.toBeInstanceOf(RedirectSignal);
    expect(db.events.find((row) => row.id === 'evt_new')).toMatchObject({ authorLogin: 'bob' });

    await setEventStatus('evt_draft', 'CONFIRMED');
    expect(db.events.find((row) => row.id === 'evt_draft')?.status).toBe('CONFIRMED');
    expect(db.audit.map((entry) => [entry.actorLogin, entry.action])).toEqual([
      ['bob', 'event.create'],
      ['bob', 'event.create'],
      ['bob', 'event.status_change'],
    ]);
  });

  it("a member's personal feed link works while the account exists", async () => {
    const response = await subscriptionFeed(
      new Request(`http://localhost/api/calendar/${FEED_TOKEN}`),
      {
        params: Promise.resolve({ token: FEED_TOKEN }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('SECRET DRAFT');
  });
});
