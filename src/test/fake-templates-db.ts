import type { Prisma } from '@/generated/prisma/client';

/**
 * An in-memory database for the tests of the notification templates: the three tables and the audit log, with the guarantees the service
 * relies on, so that a bug of the application shows up as a failing test.
 *
 * - **Transactions roll back**: if the callback throws, every write of the transaction is undone.
 * - **The unique indexes of the migration exist**: one template for a (type, scope), one history row for a (type, scope, version), one name
 *   for a (platform, key): a second one throws Prisma's P2002.
 * - Serialization failures (Prisma's P2034) can be injected, to test the retry and what happens after the last try.
 *
 * What a real PostgreSQL adds (the CHECK constraints, two saves at the same time) is held by `service.db.test.ts`, which runs in the
 * `migrations` job.
 */

type Row = Record<string, unknown>;

interface State {
  templates: Row[];
  versions: Row[];
  mentions: Row[];
  audit: Row[];
}

const databaseError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export function createFakeTemplatesDb() {
  let state: State = { templates: [], versions: [], mentions: [], audit: [] };
  let nextId = 1;
  let serializationFailures = 0;
  let uniqueViolations = 0;
  let transactionRuns = 0;
  let tick = 0;

  const id = (prefix: string) => `${prefix}${nextId++}`;
  const now = () => new Date(Date.UTC(2026, 9, 23, 12, 0, tick++));

  /** `where` of the queries the service makes: plain equality, `lte` on a number, and the compound unique keys. */
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true; // Prisma drops an undefined filter
      if (value !== null && typeof value === 'object' && 'lte' in (value as Row)) {
        return (row[key] as number) <= ((value as Row).lte as number);
      }
      return row[key] === value;
    });

  const unique = (where: Row): Row => {
    const [key, value] = Object.entries(where)[0] as [string, Row | unknown];
    return value !== null && typeof value === 'object' && !(value instanceof Date)
      ? (value as Row)
      : { [key]: value };
  };

  const copy = <T>(row: T): T => ({ ...(row as object) }) as T;

  const templates = {
    findUnique: async ({ where }: { where: Row }) =>
      state.templates.find((row) => matches(row, unique(where))) ?? null,
    findMany: async ({ where }: { where?: Row } = {}) =>
      state.templates.filter((row) => matches(row, where)).map(copy),
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const existing = state.templates.find((row) => matches(row, unique(where)));
      if (existing) return Object.assign(existing, update, { updatedAt: now() });
      const row = {
        id: id('t'),
        ...create,
        updatedAt: now(),
        lastFallbackAt: null,
        lastFallbackReason: null,
      };
      state.templates.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const existing = state.templates.find((row) => matches(row, unique(where)));
      if (!existing) throw databaseError('P2025', 'record not found');
      return Object.assign(existing, data, { updatedAt: now() });
    },
    delete: async ({ where }: { where: Row }) => {
      const index = state.templates.findIndex((row) => matches(row, unique(where)));
      if (index < 0) throw databaseError('P2025', 'record not found');
      return state.templates.splice(index, 1)[0];
    },
  };

  const versions = {
    create: async ({ data }: { data: Row }) => {
      if (uniqueViolations > 0) {
        uniqueViolations -= 1;
        throw databaseError('P2002', 'unique violation (injected)');
      }
      if (
        state.versions.some(
          (row) =>
            row.type === data.type && row.scope === data.scope && row.version === data.version,
        )
      ) {
        throw databaseError('P2002', 'unique violation on (type, scope, version)');
      }
      // a column left out is NULL, as in the database
      const row = { id: id('v'), ...data, content: data.content ?? null, createdAt: now() };
      state.versions.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const before = state.versions.length;
      state.versions = state.versions.filter((row) => !matches(row, where));
      return { count: before - state.versions.length };
    },
    aggregate: async ({ where }: { where: Row }) => {
      const found = state.versions.filter((row) => matches(row, where));
      return {
        _max: {
          version: found.length ? Math.max(...found.map((row) => row.version as number)) : null,
        },
      };
    },
    findUnique: async ({ where }: { where: Row }) =>
      state.versions.find((row) => matches(row, unique(where))) ?? null,
  };

  const mentions = {
    findMany: async () => state.mentions.map(copy),
    findUnique: async ({ where }: { where: Row }) =>
      state.mentions.find((row) => matches(row, unique(where))) ?? null,
    create: async ({ data }: { data: Row }) => {
      if (state.mentions.some((row) => row.platform === data.platform && row.key === data.key)) {
        throw databaseError('P2002', 'unique violation on (platform, key)');
      }
      const row = { id: id('m'), ...data, createdAt: now() };
      state.mentions.push(row);
      return row;
    },
    delete: async ({ where }: { where: Row }) => {
      const index = state.mentions.findIndex((row) => matches(row, unique(where)));
      if (index < 0) throw databaseError('P2025', 'record not found');
      return state.mentions.splice(index, 1)[0];
    },
  };

  const auditLog = {
    create: async ({ data }: { data: Row }) => {
      state.audit.push(copy(data));
      return data;
    },
  };

  const client = {
    notificationTemplate: templates,
    notificationTemplateVersion: versions,
    notificationMention: mentions,
    auditLog,
  };

  return {
    prisma: {
      ...client,
      $transaction: async <T>(work: (tx: typeof client) => Promise<T>): Promise<T> => {
        transactionRuns += 1;
        if (serializationFailures > 0) {
          serializationFailures -= 1;
          throw databaseError('P2034', 'could not serialize access');
        }
        const snapshot: State = JSON.parse(JSON.stringify(state), (_key, value) =>
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : value,
        );
        try {
          return await work(client);
        } catch (error) {
          state = snapshot;
          throw error;
        }
      },
    } as unknown as Prisma.TransactionClient & { $transaction: unknown },
    /** The next `count` writes to the history fail as if another save had written the same version first. */
    failUniqueVersion: (count: number) => {
      uniqueViolations = count;
    },
    /** The next `count` transactions fail as if the database could not serialize them. */
    failSerialization: (count: number) => {
      serializationFailures = count;
    },
    get transactionRuns() {
      return transactionRuns;
    },
    get templates() {
      return state.templates;
    },
    get versions() {
      return state.versions;
    },
    get mentions() {
      return state.mentions;
    },
    get audit() {
      return state.audit;
    },
    /** Puts rows in as they are, for a test that starts from something the service did not write. */
    seed(rows: Partial<State>) {
      state = { ...state, ...rows } as State;
    },
  };
}
