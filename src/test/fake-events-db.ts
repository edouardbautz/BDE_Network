/**
 * An in-memory database for the tests of series of events: the tables of the events module with the Prisma calls
 * the series operations and the actions make, and the guarantees of the real one that matter here.
 *
 * - Prisma semantics: a filter whose value is `undefined` is not applied.
 * - A transaction that throws is rolled back (every write undone), and a serialization failure (P2034) can be
 *   injected to test the retry.
 * - The unique indexes of the schema exist: (eventId, occurrenceStart) on dates with values of their own,
 *   cancellations and reminders, (occurrenceId, login) on a date's members in charge. Breaking one throws P2002.
 * - Deleting an event cascades to everything that hangs from it, as `onDelete: Cascade` does.
 */

type Row = Record<string, unknown> & { id: string };
/** What a test or a call hands in: a row, the id is made when it is missing. */
type Input = Record<string, unknown>;
type Where = Record<string, unknown>;

interface State {
  event: Row[];
  eventAssignee: Row[];
  eventOccurrence: Row[];
  eventOccurrenceAssignee: Row[];
  eventCancellation: Row[];
  eventReminder: Row[];
  user: Row[];
  auditLog: Row[];
}

const TABLES = [
  'event',
  'eventAssignee',
  'eventOccurrence',
  'eventOccurrenceAssignee',
  'eventCancellation',
  'eventReminder',
  'user',
  'auditLog',
] as const;
type TableName = (typeof TABLES)[number];

const UNIQUE: Partial<Record<TableName, string[]>> = {
  eventOccurrence: ['eventId', 'occurrenceStart'],
  eventCancellation: ['eventId', 'occurrenceStart'],
  eventReminder: ['eventId', 'occurrenceStart'],
  eventOccurrenceAssignee: ['occurrenceId', 'login'],
  eventAssignee: ['eventId', 'login'],
};

function databaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true; // Prisma drops an undefined filter
    if (key === 'OR') return (condition as Where[]).some((clause) => matches(row, clause));
    if (key === 'AND') return (condition as Where[]).every((clause) => matches(row, clause));
    // A compound unique key: { eventId_occurrenceStart: { eventId, occurrenceStart } }
    if (key.includes('_') && typeof condition === 'object' && !(condition instanceof Date)) {
      return matches(row, condition as Where);
    }
    if (condition instanceof Date || condition === null || typeof condition !== 'object') {
      return same(row[key], condition);
    }
    const operators = condition as Record<string, unknown>;
    const value = row[key];
    const time = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
    return Object.entries(operators).every(([operator, expected]) => {
      switch (operator) {
        case 'gte':
          return time(value) >= time(expected);
        case 'gt':
          return time(value) > time(expected);
        case 'lte':
          return time(value) <= time(expected);
        case 'lt':
          return time(value) < time(expected);
        case 'in':
          return (expected as unknown[]).some((v) => same(v, value));
        case 'not':
          return !same(value, expected);
        default:
          throw new Error(`fake database: unsupported operator ${operator} on ${key}`);
      }
    });
  });
}

export function createFakeEventsDb() {
  let state: State = Object.fromEntries(TABLES.map((name) => [name, []])) as unknown as State;
  let nextId = 1;
  let serializationFailures = 0;
  let transactionRuns = 0;

  const newId = (prefix: string) => `${prefix}${nextId++}`;

  const rows = (name: TableName) => state[name];

  function assertUnique(name: TableName, row: Row, ignoring?: Row) {
    const keys = UNIQUE[name];
    if (!keys) return;
    const clash = rows(name).find(
      (other) => other !== ignoring && keys.every((key) => same(other[key], row[key])),
    );
    if (clash) throw databaseError('P2002', `Unique constraint failed on ${name}`);
  }

  function insert(name: TableName, data: Input, withDefaults: Input = {}): Row {
    const row: Row = {
      ...withDefaults,
      ...data,
      id: (data.id as string | undefined) ?? newId(`${name}-`),
    };
    assertUnique(name, row);
    rows(name).push(row);
    return row;
  }

  /** What tables know to fill in: defaults of the schema. */
  const defaults: Partial<Record<TableName, () => Row>> = {
    event: () => ({
      id: '',
      description: null,
      location: null,
      status: 'DRAFT',
      recurrence: 'NONE',
      recurrenceUntil: null,
      monthlyDay: null,
      seriesId: null,
      confirmationNotifiedAt: null,
      authorId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    eventOccurrence: () => ({
      id: '',
      title: null,
      description: null,
      location: null,
      categoryKey: null,
      status: null,
      startsAt: null,
      endsAt: null,
      assigneesOverridden: false,
      confirmationNotifiedAt: null,
      updatedAt: new Date(0),
    }),
  };

  function cascadeFromEvent(eventId: string) {
    const occurrenceIds = state.eventOccurrence
      .filter((o) => o.eventId === eventId)
      .map((o) => o.id);
    state.eventOccurrenceAssignee = state.eventOccurrenceAssignee.filter(
      (a) => !occurrenceIds.includes(a.occurrenceId as string),
    );
    for (const name of [
      'eventAssignee',
      'eventOccurrence',
      'eventCancellation',
      'eventReminder',
    ] as const) {
      state[name] = state[name].filter((row) => row.eventId !== eventId);
    }
  }

  function cascadeFromOccurrence(occurrenceId: string) {
    state.eventOccurrenceAssignee = state.eventOccurrenceAssignee.filter(
      (a) => a.occurrenceId !== occurrenceId,
    );
  }

  /** The reading of an event the series code asks for (`eventInclude`). */
  function withIncludes(event: Row): Row {
    const person = (a: Row) => ({
      login: a.login,
      userId: a.userId ?? null,
      user: state.user.find((u) => u.id === a.userId) ?? null,
    });
    return {
      ...event,
      assignees: state.eventAssignee.filter((a) => a.eventId === event.id).map(person),
      cancellations: state.eventCancellation
        .filter((c) => c.eventId === event.id)
        .map((c) => ({ occurrenceStart: c.occurrenceStart })),
      occurrences: state.eventOccurrence
        .filter((o) => o.eventId === event.id)
        .map((o) => ({
          ...o,
          assignees: state.eventOccurrenceAssignee
            .filter((a) => a.occurrenceId === o.id)
            .map(person),
        })),
    };
  }

  function table(name: TableName) {
    const touch = (row: Row, data: Row) => {
      Object.assign(row, data);
      if ('updatedAt' in row) row.updatedAt = new Date();
    };
    return {
      create: async ({ data }: { data: Input }) => {
        const { assignees, ...own } = data as Input & { assignees?: { create: Input[] } };
        const row = insert(name, own, defaults[name]?.());
        if (name === 'event' && assignees) {
          for (const a of assignees.create) insert('eventAssignee', { ...a, eventId: row.id });
        }
        return { ...row };
      },
      createMany: async ({ data }: { data: Input[] }) => {
        for (const row of data) insert(name, row);
        return { count: data.length };
      },
      findUnique: async ({ where, include }: { where: Where; include?: unknown }) => {
        const row = rows(name).find((r) => matches(r, where));
        if (!row) return null;
        return name === 'event' && include ? withIncludes(row) : { ...row };
      },
      findMany: async ({ where }: { where?: Where } = {}) =>
        rows(name)
          .filter((r) => matches(r, where))
          .map((r) => ({ ...r })),
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const row = rows(name).find((r) => matches(r, where));
        if (!row) throw databaseError('P2025', `${name} not found`);
        const before = { ...row };
        touch(row, data);
        try {
          assertUnique(name, row, row);
        } catch (error) {
          Object.assign(row, before);
          throw error;
        }
        return { ...row };
      },
      updateMany: async ({ where, data }: { where?: Where; data: Row }) => {
        const targets = rows(name).filter((r) => matches(r, where));
        for (const row of targets) touch(row, data);
        return { count: targets.length };
      },
      upsert: async ({ where, update, create }: { where: Where; update: Row; create: Row }) => {
        const row = rows(name).find((r) => matches(r, where));
        if (row) {
          touch(row, update);
          return { ...row };
        }
        return { ...insert(name, create, defaults[name]?.()) };
      },
      delete: async ({ where }: { where: Where }) => {
        const row = rows(name).find((r) => matches(r, where));
        if (!row) throw databaseError('P2025', `${name} not found`);
        state[name] = rows(name).filter((r) => r !== row);
        if (name === 'event') cascadeFromEvent(row.id);
        if (name === 'eventOccurrence') cascadeFromOccurrence(row.id);
        return { ...row };
      },
      deleteMany: async ({ where }: { where?: Where } = {}) => {
        const targets = rows(name).filter((r) => matches(r, where));
        state[name] = rows(name).filter((r) => !targets.includes(r));
        for (const row of targets) {
          if (name === 'event') cascadeFromEvent(row.id);
          if (name === 'eventOccurrence') cascadeFromOccurrence(row.id);
        }
        return { count: targets.length };
      },
    };
  }

  const client = Object.fromEntries(TABLES.map((name) => [name, table(name)])) as Record<
    TableName,
    ReturnType<typeof table>
  >;

  const prisma = {
    ...client,
    $transaction: async <T>(work: (tx: typeof client) => Promise<T>): Promise<T> => {
      transactionRuns += 1;
      if (serializationFailures > 0) {
        serializationFailures -= 1;
        throw databaseError('P2034', 'could not serialize access');
      }
      const snapshot = structuredClone(state);
      try {
        return await work(client);
      } catch (error) {
        state = snapshot; // a failed transaction leaves nothing behind
        throw error;
      }
    },
  };

  return {
    prisma,
    /** Inserts rows as the seed would (with the schema's defaults). */
    add: (name: TableName, ...data: Input[]) =>
      data.map((row) => insert(name, row, defaults[name]?.())),
    table: (name: TableName) => rows(name).map((row) => ({ ...row })),
    event: (id: string) => {
      const row = state.event.find((e) => e.id === id);
      return row ? withIncludes(row) : undefined;
    },
    failNextTransactions: (count: number) => {
      serializationFailures = count;
    },
    get transactionRuns() {
      return transactionRuns;
    },
    reset: () => {
      state = Object.fromEntries(TABLES.map((name) => [name, []])) as unknown as State;
      nextId = 1;
      serializationFailures = 0;
      transactionRuns = 0;
    },
  };
}

export type FakeEventsDb = ReturnType<typeof createFakeEventsDb>;
