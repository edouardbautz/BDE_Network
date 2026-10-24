import {
  alignStart,
  cutRule,
  endOfCountedRule,
  expandRepeat,
  normalizeRule,
  type MonthlyPattern,
  type RepeatRule,
  type Weekday,
} from '../src/lib/events/repeat';
import { INTRA_KINDS, type IntraFields } from '../src/lib/events/intra';
import {
  hashContent,
  intraReadiness,
  type IntraContent,
  type IntraSource,
} from '../src/lib/events/intra-request';
import {
  addDays,
  fromLocalDateTime,
  schoolYearOf,
  toLocalDateTime,
  type LocalDate,
} from '../src/lib/events/time';
import { createRandom, type Random } from './prng';
import {
  PERSONAS,
  ROLE_CUSTOM,
  ROLE_PROPOSER,
  ROLE_STAFF,
  ROLE_VALIDATOR,
  type PersonaRole,
} from './personas';

/**
 * A believable BDE, as SQL: two school years of members, roles, events (single, series, cut series, drafts, proposals,
 * refusals), dates of a series that were moved, cancelled or reminded, and the audit trail of all of it. It is the
 * data the quality suites run on (access, load, updates, resilience, long time), so a defect that only shows with a
 * year of data shows there.
 *
 * Deterministic: the same options give the same SQL, byte for byte. It goes through the real engine for the dates of
 * the series (`repeat.ts`), so what it writes is what the application would have written.
 */

export interface DatasetOptions {
  seed?: number;
  /** Members besides the nine personas. */
  members?: number;
  /** Events and series per school year. */
  eventsPerYear?: number;
  /** How many school years end with the one that holds `now`. */
  schoolYears?: number;
  timeZone?: string;
  /** The reference "today" of the data (events are past or to come relative to it). */
  now?: Date;
}

export interface Dataset {
  sql: string;
  stats: Record<string, number>;
}

/**
 * What the suites of the campaign name: accounts, a role and events with fixed identifiers, so that a test can say
 * "the proposal of somebody else" without looking for one in the random part of the dataset.
 */
export const FIXTURES = {
  accounts: {
    /** A member who proposes events, like the proposer persona but somebody else: the author of "other people's" events. */
    colleague: { id: 'qa-fixture-colleague', login: 'qa-colleague' },
    /** An account waiting for approval (approving or refusing it is what the suites do). */
    applicant: { id: 'qa-fixture-applicant', login: 'qa-applicant' },
    /** A member with the default role, whom the suites remove or give another role. */
    leaver: { id: 'qa-fixture-leaver', login: 'qa-leaver' },
  },
  /** A role nobody holds: the one that is edited and deleted. */
  spareRole: 'role-qa-spare',
  events: {
    /** Published, written by the validator persona. */
    confirmed: 'qa-fx-confirmed',
    /** A draft written by the validator persona: nobody but those who validate may see it. */
    draft: 'qa-fx-draft',
    /** A proposal of the colleague. */
    proposed: 'qa-fx-proposed',
    /** A weekly series of 6 dates, published, written by the validator persona. */
    series: 'qa-fx-series',
    /** The proposer persona's own draft, own proposal and own published event. */
    ownDraft: 'qa-fx-own-draft',
    ownProposed: 'qa-fx-own-proposed',
    ownConfirmed: 'qa-fx-own-confirmed',
    /** Published, written by the validator persona, with a request for the intra in each state the staff and the BDE meet. */
    intraPending: 'qa-fx-intra-pending',
    intraPublished: 'qa-fx-intra-published',
    intraOutdated: 'qa-fx-intra-outdated',
    intraRefused: 'qa-fx-intra-refused',
  },
} as const;

const DEFAULTS = {
  seed: 20261016,
  members: 300,
  eventsPerYear: 300,
  schoolYears: 2,
  timeZone: 'Europe/Paris',
  now: new Date('2026-10-16T12:00:00Z'),
} as const;

const FIRST_NAMES = [
  'Alice',
  'Bruno',
  'Camille',
  'David',
  'Emma',
  'Farid',
  'Gaëlle',
  'Hugo',
  'Inès',
  'Jules',
  'Kenza',
  'Léo',
  'Manon',
  'Nathan',
  'Océane',
  'Paul',
  'Quentin',
  'Rania',
  'Sacha',
  'Thomas',
  'Ulysse',
  'Valentine',
  'William',
  'Xavier',
  'Yasmine',
  'Zoé',
  'Adrien',
  'Béatrice',
  'Clément',
  'Diane',
  'Étienne',
  'Fanny',
  'Gabriel',
  'Hélène',
];
const LAST_NAMES = [
  'Martin',
  'Bernard',
  'Dubois',
  'Thomas',
  'Robert',
  'Richard',
  'Petit',
  'Durand',
  'Leroy',
  'Moreau',
  'Simon',
  'Laurent',
  'Lefebvre',
  'Michel',
  'Garcia',
  'David',
  'Bertrand',
  'Roux',
  'Vincent',
  'Fournier',
  'Morel',
  'Girard',
  'André',
  'Mercier',
  'Dupont',
  "N'Diaye",
  'Ben Amar',
  'Lambert',
  'Fontaine',
  'Rousseau',
];
const CAMPUSES = ['Paris', 'Nice', 'Lyon', 'Angoulême', 'Le Havre', 'Mulhouse', 'Perpignan'];
const CATEGORIES = ['soiree', 'sport', 'wei', 'partenariat'] as const;
const TITLES = [
  'Soirée de rentrée',
  'Tournoi de foot',
  'Afterwork partenaires',
  'Week-end d’intégration',
  'Soirée jeux de société',
  'Karaoké',
  'Sortie ski',
  'Barbecue de fin d’année',
  'Conférence d’un ancien',
  'Atelier cuisine',
  'Match amical',
  'Soirée cinéma',
  'Tournoi de jeux vidéo',
  'Collecte de dons',
  'Visite d’entreprise',
  'Gala',
  'Pot d’accueil',
];
const SERIES_TITLES = [
  'Entraînement de basket',
  'Permanence du bureau',
  'Café des associations',
  'Séance de sport',
  'Réunion du pôle',
  'Atelier peinture',
  'Répétition de la chorale',
  'Soirée jeux hebdomadaire',
];
const PLACES = [
  'Foyer du campus',
  'Salle B',
  'Gymnase',
  'Amphi 2',
  'Bar Le Coin',
  'Parc municipal',
  'Cluster 3',
  'Hall',
];
const REFUSALS = [
  'Cette date tombe pendant les examens.',
  'Le budget n’est pas voté pour cet événement.',
  'La salle est déjà prise ce jour-là.',
];

// ---- SQL ------------------------------------------------------------------------------------------------------------

interface Raw {
  raw: string;
}
type Value = string | number | boolean | Date | null | Raw;

const sqlJson = (value: unknown): Raw => ({
  raw: `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`,
});
/** FNV-1a: the same text gives the same number on every machine, which is all a dataset needs of it. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

const INTRA_KEYWORD_SETS = [
  ['bde'],
  ['bde', 'soirée'],
  ['sport', 'détente'],
  ['conférence', 'carrière', 'bde'],
];

/**
 * The intra's fields of an event: the same for every row of a series (a cut series' second row has its first row's), and
 * none for one event in five, as an event written before them. Derived from the identifier, never drawn from the generator:
 * the rest of the dataset (which the visual references and the other suites read) stays as it was.
 */
function intraFieldsOf(row: EventRow): IntraFields | null {
  const hash = hashOf(row.seriesId ?? row.id);
  // The events of the fixtures all have them: any of them can be confirmed, and asked for, by the suites.
  if (hash % 5 === 0 && !FIXTURE_EVENT_IDS.has(row.id)) return null;
  return {
    organizerLogin: row.authorLogin,
    audience: (['STUDENTS', 'PISCINERS', 'BOTH'] as const)[hash % 3]!,
    maxPeople: 10 + (hash % 12) * 10,
    waitingList: hash % 2 === 0,
    kind: INTRA_KINDS[hash % INTRA_KINDS.length]!,
    unsubscribeHours: (hash % 4) * 12,
    keywords: INTRA_KEYWORD_SETS[hash % INTRA_KEYWORD_SETS.length]!,
  };
}

const FIXTURE_EVENT_IDS: ReadonlySet<string> = new Set(Object.values(FIXTURES.events));

function intraValues(row: EventRow): Value[] {
  const fields = intraFieldsOf(row);
  if (!fields) return [null, null, null, null, null, null, sqlTextArray([])];
  return [
    fields.organizerLogin,
    fields.audience,
    fields.maxPeople,
    fields.waitingList,
    fields.kind,
    fields.unsubscribeHours,
    sqlTextArray(fields.keywords),
  ];
}

const sqlTextArray = (values: readonly string[]): Raw => ({
  raw: `ARRAY[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')}]::text[]`,
});

function sqlValue(value: Value): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString().replace('T', ' ').replace('Z', '')}'`;
  if (typeof value === 'object') return value.raw;
  return `'${value.replace(/'/g, "''")}'`;
}

class Script {
  private readonly statements: string[] = [];
  readonly counts: Record<string, number> = {};

  insert(table: string, columns: readonly string[], rows: readonly (readonly Value[])[]): void {
    if (rows.length === 0) return;
    this.counts[table] = (this.counts[table] ?? 0) + rows.length;
    const names = columns.map((column) => `"${column}"`).join(', ');
    for (let from = 0; from < rows.length; from += 100) {
      const chunk = rows.slice(from, from + 100);
      this.statements.push(
        `INSERT INTO "${table}" (${names}) VALUES\n${chunk
          .map((row) => `  (${row.map(sqlValue).join(', ')})`)
          .join(',\n')};`,
      );
    }
  }

  toString(): string {
    return `BEGIN;\n${this.statements.join('\n')}\nCOMMIT;\n`;
  }
}

// ---- the templates of the notifications ----------------------------------------------------------------------------------

interface TemplateFixture {
  type: string;
  scope: string;
  /** The versions kept, oldest first: what made each, and what it held (null: a return to the platform's own). */
  versions: { action: string; content: object | null; by: string }[];
}

/** The people a template can mention, as a BDE would have put them in its directory. */
const MENTIONS = [
  ['discord', 'role', 'bureau', 'Le Bureau', '123456789012345678', 'qa-owner'],
  ['discord', 'user', 'paula', 'Paula', '223456789012345678', 'qa-validator'],
  ['slack', 'group', 'bureau', 'Le Bureau', 'S01ABCDE2F3', 'qa-owner'],
] as const;

/**
 * What a BDE that has customised its notifications holds: a template for all channels with a button of its own, a channel that left
 * it with a mention above the card and a free text, an e-mail with its own subject, a Slack message, a template of the members, a
 * history with a return to the platform's own and a restore. All of it is valid for the engine of the repository (the invariants
 * say so), and written by accounts of the dataset so that the removal of an account is played over it.
 */
const TEMPLATES: readonly TemplateFixture[] = [
  {
    type: 'eventConfirmed',
    scope: 'all',
    versions: [
      { action: 'save', content: { title: '{title}' }, by: 'qa-owner' },
      { action: 'reset', content: null, by: 'qa-owner' },
      {
        action: 'save',
        content: {
          eyebrow: 'Nouvelle soirée au BDE',
          title: '{title} · {place}',
          color: '#7c3aed',
          button: {
            enabled: true,
            label: "Je m'inscris",
            url: 'https://forms.example.fr/inscription',
          },
          footer: 'Le BDE vous attend',
        },
        by: 'qa-validator',
      },
    ],
  },
  {
    type: 'eventConfirmed',
    scope: 'discord',
    versions: [
      {
        action: 'save',
        content: {
          above: '{@role:bureau} nouvelle date !',
          emoji: '🎉',
          items: {
            order: 'custom',
            list: [
              { id: 'when', enabled: true },
              { id: 'where', enabled: true, label: 'Où ça ?', emoji: '📍' },
              { id: 'description', enabled: true },
              { id: 'category', enabled: false },
              { id: 'assignees', enabled: false },
              { id: 'repeats', enabled: false },
              { id: 'text:a1b2c3', enabled: true, text: '**Venez nombreux** !' },
            ],
          },
        },
        by: 'qa-owner',
      },
      {
        action: 'restore:1',
        content: {
          above: '{@role:bureau} nouvelle date !',
          emoji: '🎉',
          items: {
            order: 'custom',
            list: [
              { id: 'when', enabled: true },
              { id: 'where', enabled: true, label: 'Où ça ?', emoji: '📍' },
              { id: 'description', enabled: true },
              { id: 'category', enabled: false },
              { id: 'assignees', enabled: false },
              { id: 'repeats', enabled: false },
              { id: 'text:a1b2c3', enabled: true, text: '**Venez nombreux** !' },
            ],
          },
        },
        by: 'qa-validator',
      },
    ],
  },
  {
    type: 'eventReminder',
    scope: 'email',
    versions: [
      {
        action: 'save',
        content: {
          subject: 'Rappel : {title} {day}',
          preheader: 'Ne manquez pas {title}',
          note: "Pensez à vous inscrire avant l'événement.",
        },
        by: 'qa-validator',
      },
    ],
  },
  {
    type: 'memberPending',
    scope: 'slack',
    versions: [
      {
        action: 'save',
        content: { above: '{@here}', title: 'Nouvelle demande de {name}' },
        by: 'qa-owner',
      },
    ],
  },
  {
    type: 'memberRemoved',
    scope: 'all',
    versions: [
      { action: 'save', content: { footer: 'Merci pour votre engagement' }, by: 'qa-owner' },
    ],
  },
];

function addTemplates(context: Context): void {
  const person = (login: string) => context.people.find((candidate) => candidate.login === login);
  const at = (days: number) => new Date(context.now.getTime() - days * 86_400_000);

  context.script.insert(
    'NotificationMention',
    ['id', 'key', 'platform', 'kind', 'label', 'externalId', 'createdByLogin', 'createdAt'],
    MENTIONS.map(([platform, kind, key, label, externalId, by], index) => [
      `qa-mention-${index + 1}`,
      key,
      platform,
      kind,
      label,
      externalId,
      by,
      at(30),
    ]),
  );
  for (const [platform, , key, , , by] of MENTIONS) {
    context.audit.push({
      id: nextId(context, 'qa-aud'),
      actorLogin: by,
      actorId: person(by)?.id ?? null,
      action: 'notification_mention.add',
      targetType: 'NotificationMention',
      targetId: `${platform}:${key}`,
      targetLabel: `${platform}:${key}`,
      metadata: { platform, key },
      createdAt: at(30),
    });
  }

  const templates: Value[][] = [];
  const versions: Value[][] = [];
  for (const [index, fixture] of TEMPLATES.entries()) {
    const last = fixture.versions[fixture.versions.length - 1]!;
    const id = `qa-template-${index + 1}`;
    templates.push([
      id,
      fixture.type,
      fixture.scope,
      sqlJson(last.content),
      fixture.versions.length,
      1,
      at(10 - index),
      last.by,
      person(last.by)?.id ?? null,
    ]);
    for (const [number, version] of fixture.versions.entries()) {
      const createdAt = at(20 - number * 3 - index);
      versions.push([
        `qa-template-version-${index + 1}-${number + 1}`,
        fixture.type,
        fixture.scope,
        number + 1,
        version.content ? sqlJson(version.content) : null,
        1,
        version.action,
        version.by,
        person(version.by)?.id ?? null,
        createdAt,
      ]);
      context.audit.push({
        id: nextId(context, 'qa-aud'),
        actorLogin: version.by,
        actorId: person(version.by)?.id ?? null,
        action:
          version.action === 'reset'
            ? 'notification_template.reset'
            : version.action.startsWith('restore')
              ? 'notification_template.restore'
              : 'notification_template.update',
        targetType: 'NotificationTemplate',
        targetId: `${fixture.type}:${fixture.scope}`,
        targetLabel: `${fixture.type} · ${fixture.scope}`,
        metadata: { type: fixture.type, scope: fixture.scope, version: number + 1 },
        createdAt,
      });
    }
  }
  context.script.insert(
    'NotificationTemplate',
    [
      'id',
      'type',
      'scope',
      'content',
      'version',
      'basedOnRevision',
      'updatedAt',
      'updatedByLogin',
      'updatedById',
    ],
    templates,
  );
  context.script.insert(
    'NotificationTemplateVersion',
    [
      'id',
      'type',
      'scope',
      'version',
      'content',
      'basedOnRevision',
      'action',
      'authorLogin',
      'authorId',
      'createdAt',
    ],
    versions,
  );
}

// ---- the people -----------------------------------------------------------------------------------------------------

interface Person {
  id: string;
  login: string;
  fullName: string;
  email: string;
  campus: string;
  status: 'OWNER' | 'MEMBER' | 'PENDING';
  roleId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  calendarToken: string | null;
  canPropose: boolean;
  canValidate: boolean;
}

const ASCII = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const token = (rng: Random): string =>
  Array.from({ length: 43 }, () => TOKEN_ALPHABET[rng.int(0, TOKEN_ALPHABET.length - 1)]).join('');

const day = (ms: number) => ms * 86_400_000;

const EXTRA_ROLES: readonly PersonaRole[] = [
  ROLE_PROPOSER,
  ROLE_VALIDATOR,
  ROLE_CUSTOM,
  ROLE_STAFF,
  {
    id: 'role-qa-president',
    name: 'Président',
    description: 'Manages members, roles and the events.',
    permissions: [
      'members.manage',
      'roles.manage',
      'events.view',
      'events.propose',
      'events.validate',
      'events.shared_calendar',
    ],
    allPermissions: false,
    builtin: false,
  },
  {
    id: 'role-qa-treasurer',
    name: 'Trésorier',
    description: 'Sees the events and manages the shared calendar.',
    permissions: ['events.view', 'events.shared_calendar'],
    allPermissions: false,
    builtin: false,
  },
  {
    id: FIXTURES.spareRole,
    name: 'QA Rôle libre',
    description: 'Held by nobody: edited and deleted by the suites.',
    permissions: ['events.view'],
    allPermissions: false,
    builtin: false,
  },
  {
    id: 'role-qa-events-team',
    name: 'Pôle Events',
    description: 'Proposes events.',
    permissions: ['events.view', 'events.propose'],
    allPermissions: false,
    builtin: false,
  },
];

function buildPeople(rng: Random, members: number, now: Date): Person[] {
  const people: Person[] = [];
  const logins = new Set<string>();
  const rights = (roleId: string | null) => ({
    canPropose: [
      'role-qa-proposer',
      'role-qa-validator',
      'role-qa-president',
      'role-qa-events-team',
      'role-admin',
    ].includes(roleId ?? ''),
    canValidate: ['role-qa-validator', 'role-qa-president', 'role-admin'].includes(roleId ?? ''),
  });

  for (const who of PERSONAS) {
    if (!who.login || !who.status) continue;
    logins.add(who.login);
    const roleId = who.role?.id ?? null;
    people.push({
      id: `qa-persona-${who.key}`,
      login: who.login,
      fullName: `QA ${who.key}`,
      email: `${who.login}@example.org`,
      campus: 'Paris',
      status: who.status,
      roleId,
      createdAt: new Date(now.getTime() - day(400)),
      lastLoginAt: new Date(now.getTime() - day(1)),
      calendarToken: who.status === 'PENDING' ? null : token(rng),
      ...(who.status === 'OWNER' ? { canPropose: true, canValidate: true } : rights(roleId)),
    });
  }

  for (const [key, status, roleId] of [
    ['colleague', 'MEMBER', ROLE_PROPOSER.id],
    ['applicant', 'PENDING', null],
    ['leaver', 'MEMBER', 'role-member'],
  ] as const) {
    const account = FIXTURES.accounts[key];
    logins.add(account.login);
    people.push({
      id: account.id,
      login: account.login,
      fullName: `QA ${key}`,
      email: `${account.login}@example.org`,
      campus: 'Paris',
      status,
      roleId,
      createdAt: new Date(now.getTime() - day(300)),
      lastLoginAt: status === 'PENDING' ? null : new Date(now.getTime() - day(2)),
      calendarToken: status === 'PENDING' ? null : token(rng),
      ...rights(roleId),
    });
  }

  for (let index = 1; index <= members; index += 1) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    let login = `${ASCII(first).slice(0, 1)}${ASCII(last)}`.slice(0, 8);
    for (let n = 2; logins.has(login); n += 1) login = `${login.replace(/\d+$/, '')}${n}`;
    logins.add(login);

    const status = rng.weighted([
      ['MEMBER', 94],
      ['PENDING', 6],
    ] as const);
    const roleId =
      status !== 'MEMBER'
        ? null
        : rng.weighted([
            ['role-member', 72],
            ['role-qa-events-team', 12],
            ['role-qa-treasurer', 4],
            ['role-qa-custom', 5],
            ['role-qa-validator', 4],
            ['role-qa-president', 1],
            ['role-admin', 2],
          ] as const);
    const createdAt = new Date(now.getTime() - day(rng.int(5, 700)));
    people.push({
      id: `qa-user-${String(index).padStart(4, '0')}`,
      login,
      fullName: `${first} ${last}`,
      email: `${login}@example.org`,
      campus: rng.pick(CAMPUSES),
      status,
      roleId,
      createdAt,
      lastLoginAt: status === 'PENDING' ? null : new Date(now.getTime() - day(rng.int(0, 120))),
      calendarToken: status !== 'PENDING' && rng.chance(0.3) ? token(rng) : null,
      ...rights(roleId),
    });
  }
  return people;
}

// ---- the events -----------------------------------------------------------------------------------------------------

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: 'DRAFT' | 'PROPOSED' | 'CONFIRMED';
  startsAt: Date;
  endsAt: Date;
  repeat: RepeatRule | null;
  recurrenceUntil: Date | null;
  schoolYear: string;
  confirmationNotifiedAt: Date | null;
  seriesId: string | null;
  proposedAt: Date | null;
  refusalComment: string | null;
  refusedByLogin: string | null;
  refusedAt: Date | null;
  authorLogin: string;
  authorId: string;
  createdAt: Date;
}

interface Context {
  rng: Random;
  zone: string;
  now: Date;
  people: Person[];
  validators: Person[];
  authors: Person[];
  assignable: Person[];
  script: Script;
  audit: AuditRow[];
  events: EventRow[];
  assignees: [string, string, string, string][];
  cancellations: [string, string, Date, string, string][];
  occurrences: Value[][];
  reminders: [string, string, Date, Date][];
  counter: { event: number; row: number };
}

interface AuditRow {
  id: string;
  actorLogin: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  metadata: unknown;
  createdAt: Date;
}

const nextId = (context: Context, prefix: string): string => {
  context.counter.row += 1;
  return `${prefix}-${String(context.counter.row).padStart(6, '0')}`;
};

const WEEKDAY_LIST: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function randomRule(rng: Random): RepeatRule {
  const kind = rng.weighted([
    ['weekly', 36],
    ['biweekly', 14],
    ['weekdays', 14],
    ['monthlyDay', 10],
    ['monthlyNth', 10],
    ['monthlyLast', 4],
    ['daily', 6],
    ['yearly', 3],
    ['everyTwoDays', 3],
  ] as const);
  switch (kind) {
    case 'weekly':
      return { freq: 'WEEKLY', interval: 1 };
    case 'biweekly':
      return { freq: 'WEEKLY', interval: 2, weekdays: rng.sample(WEEKDAY_LIST, rng.int(1, 3)) };
    case 'weekdays':
      return {
        freq: 'WEEKLY',
        interval: 1,
        weekdays: rng.sample(WEEKDAY_LIST.slice(0, 5), rng.int(2, 3)),
      };
    case 'monthlyDay': {
      const monthly: MonthlyPattern = { kind: 'day', day: rng.int(1, 31) };
      return rng.chance(0.5)
        ? { freq: 'MONTHLY', interval: 1, monthly }
        : { freq: 'MONTHLY', interval: 1 };
    }
    case 'monthlyNth':
      return {
        freq: 'MONTHLY',
        interval: 1,
        monthly: {
          kind: 'nth',
          nth: rng.pick([1, 2, 3, 4] as const),
          weekday: rng.pick(WEEKDAY_LIST),
        },
      };
    case 'monthlyLast':
      return {
        freq: 'MONTHLY',
        interval: rng.pick([1, 2] as const),
        monthly: rng.chance(0.5)
          ? { kind: 'lastDay' }
          : { kind: 'nth', nth: -1, weekday: rng.pick(WEEKDAY_LIST) },
      };
    case 'daily':
      return { freq: 'DAILY', interval: 1 };
    case 'everyTwoDays':
      return { freq: 'DAILY', interval: rng.pick([2, 3] as const) };
    case 'yearly':
      return { freq: 'YEARLY', interval: 1 };
  }
}

const localDay = (date: Date, zone: string): LocalDate => {
  const { year, month, day: d } = toLocalDateTime(date, zone);
  return { year, month, day: d };
};

function addEvent(context: Context, row: EventRow, members: Person[]): void {
  context.events.push(row);
  for (const member of members) {
    context.assignees.push([nextId(context, 'qa-asg'), row.id, member.id, member.login]);
  }
}

function auditEvent(context: Context, row: EventRow): void {
  const author = context.people.find((person) => person.login === row.authorLogin);
  const entry = (action: string, actorLogin: string, at: Date, metadata: unknown) =>
    context.audit.push({
      id: nextId(context, 'qa-aud'),
      actorLogin,
      actorId: context.people.find((person) => person.login === actorLogin)?.id ?? null,
      action,
      targetType: 'Event',
      targetId: row.id,
      targetLabel: row.title,
      metadata,
      createdAt: at,
    });
  entry('event.create', row.authorLogin, row.createdAt, { status: row.status });
  if (row.proposedAt) entry('event.propose', row.authorLogin, row.proposedAt, { created: true });
  if (row.refusedAt && row.refusedByLogin) {
    entry('event.refuse', row.refusedByLogin, row.refusedAt, {
      comment: row.refusalComment,
      author: row.authorLogin,
    });
  } else if (
    row.status === 'CONFIRMED' &&
    author &&
    !author.canValidate &&
    row.confirmationNotifiedAt
  ) {
    const validator = context.rng.pick(context.validators);
    entry('event.approve', validator.login, row.confirmationNotifiedAt, {
      from: 'PROPOSED',
      to: 'CONFIRMED',
    });
  }
}

/** One event or series (cut in two now and then), with what its dates have of their own. */
function generateEvent(context: Context, yearStart: number): void {
  const { rng, zone, now } = context;
  context.counter.event += 1;
  const id = `qa-evt-${String(context.counter.event).padStart(4, '0')}`;
  const isSeries = rng.chance(0.32);

  const start = addDays({ year: yearStart, month: 9, day: 1 }, rng.int(0, 360));
  const hour = rng.pick([12, 17, 18, 19, 20, 21] as const);
  const minute = rng.pick([0, 0, 30] as const);
  const startsAt = fromLocalDateTime({ ...start, hour, minute }, zone);
  const endsAt = new Date(startsAt.getTime() + rng.int(1, 5) * 3_600_000);

  const author = rng.pick(context.authors);
  const past = endsAt.getTime() < now.getTime();
  const status = past
    ? rng.weighted([
        ['CONFIRMED', 92],
        ['DRAFT', 8],
      ] as const)
    : rng.weighted([
        ['CONFIRMED', 60],
        ['DRAFT', 18],
        ['PROPOSED', 15],
        ['REFUSED', 7],
      ] as const);
  const unpublished = status === 'PROPOSED' || status === 'REFUSED';
  // Somebody who may not publish only ever has proposals: give those to a proposer who is not a validator.
  const eventAuthor = unpublished
    ? rng.pick(context.authors.filter((p) => !p.canValidate))
    : author;
  const createdAt = new Date(Math.min(now.getTime(), startsAt.getTime() - day(rng.int(10, 60))));
  const validator = rng.pick(context.validators);

  const base = {
    description: rng.chance(0.85) ? 'Venez nombreux, inscription auprès du bureau.' : null,
    location: rng.chance(0.9) ? rng.pick(PLACES) : null,
    categoryKey: rng.pick(CATEGORIES),
    schoolYear: schoolYearOf(startsAt, zone),
    authorLogin: eventAuthor.login,
    authorId: eventAuthor.id,
    createdAt,
    status: status === 'REFUSED' ? ('DRAFT' as const) : status,
    confirmationNotifiedAt: status === 'CONFIRMED' ? createdAt : null,
    proposedAt: unpublished ? new Date(createdAt.getTime() + 3_600_000) : null,
    refusalComment: status === 'REFUSED' ? rng.pick(REFUSALS) : null,
    refusedByLogin: status === 'REFUSED' ? validator.login : null,
    refusedAt: status === 'REFUSED' ? new Date(createdAt.getTime() + day(1)) : null,
    seriesId: null,
  };
  const inCharge = rng.sample(context.assignable, rng.int(0, 3));

  if (!isSeries) {
    addEvent(
      context,
      {
        ...base,
        id,
        title: rng.pick(TITLES),
        startsAt,
        endsAt,
        repeat: null,
        recurrenceUntil: null,
      },
      inCharge,
    );
    return;
  }

  // ---- a series ----
  const drawn = randomRule(rng);
  // A yearly series has a date a year: a few of them, not a count that reaches 2050.
  const rule: RepeatRule = normalizeRule({
    ...drawn,
    ...(drawn.freq === 'YEARLY'
      ? { count: rng.int(2, 4) }
      : rng.chance(0.5)
        ? { count: rng.int(4, 24) }
        : {}),
  });
  const aligned = alignStart(rule, startsAt, endsAt, zone);
  const until =
    endOfCountedRule(rule, aligned.startsAt, aligned.endsAt, zone) ??
    fromLocalDateTime(
      { ...addDays(localDay(aligned.startsAt, zone), rng.int(30, 150)), hour: 23, minute: 59 },
      zone,
    );
  const { occurrences, truncated } = expandRepeat(
    { ...aligned, repeat: rule, recurrenceUntil: until },
    zone,
  );
  if (truncated || occurrences.length < 2) {
    addEvent(
      context,
      {
        ...base,
        id,
        title: rng.pick(TITLES),
        startsAt,
        endsAt,
        repeat: null,
        recurrenceUntil: null,
      },
      inCharge,
    );
    return;
  }

  const title = rng.pick(SERIES_TITLES);
  // Some series were cut in two ("this one and the following"): the first row stops, the second carries on.
  const cutAt =
    occurrences.length >= 4 && rng.chance(0.15) ? rng.int(1, occurrences.length - 1) : null;
  const rowOf = (index: number) => (cutAt !== null && index >= cutAt ? `${id}-b` : id);

  if (cutAt === null) {
    addEvent(
      context,
      {
        ...base,
        id,
        title,
        startsAt: aligned.startsAt,
        endsAt: aligned.endsAt,
        repeat: rule,
        recurrenceUntil: until,
        schoolYear: schoolYearOf(aligned.startsAt, zone),
      },
      inCharge,
    );
  } else {
    const first = toLocalDateTime(aligned.startsAt, zone);
    const { head, tail } = cutRule(rule, first, cutAt);
    const at = occurrences[cutAt];
    const before = occurrences[cutAt - 1];
    if (!at || !before) throw new Error('cut outside the series');
    addEvent(
      context,
      {
        ...base,
        id,
        title,
        startsAt: aligned.startsAt,
        endsAt: aligned.endsAt,
        repeat: head,
        recurrenceUntil: before.start,
        schoolYear: schoolYearOf(aligned.startsAt, zone),
      },
      inCharge,
    );
    addEvent(
      context,
      {
        ...base,
        id: `${id}-b`,
        title,
        startsAt: at.start,
        endsAt: at.end,
        repeat: tail,
        recurrenceUntil: until,
        seriesId: id,
        schoolYear: schoolYearOf(at.start, zone),
      },
      inCharge,
    );
  }

  // What some dates have of their own: cancelled, edited, moved; and the reminders that went out.
  occurrences.forEach((occurrence, index) => {
    const eventId = rowOf(index);
    if (index > 0 && rng.chance(0.07)) {
      context.cancellations.push([
        nextId(context, 'qa-can'),
        eventId,
        occurrence.start,
        validator.login,
        validator.id,
      ]);
      return;
    }
    if (rng.chance(0.08)) {
      const moved = rng.chance(0.4);
      const newTitle = rng.chance(0.4) ? `${title} (spécial)` : null;
      const newPlace = rng.chance(0.5) || (!moved && newTitle === null) ? rng.pick(PLACES) : null;
      const newStart = new Date(occurrence.start.getTime() + day(1));
      const occurrenceId = nextId(context, 'qa-occ');
      context.occurrences.push([
        occurrenceId,
        eventId,
        occurrence.start,
        newTitle,
        null,
        newPlace,
        null,
        null,
        moved ? newStart : null,
        moved
          ? new Date(newStart.getTime() + (occurrence.end.getTime() - occurrence.start.getTime()))
          : null,
        false,
        null,
        occurrence.start,
      ]);
    }
    if (
      occurrence.start.getTime() < now.getTime() &&
      base.status === 'CONFIRMED' &&
      rng.chance(0.7)
    ) {
      context.reminders.push([
        nextId(context, 'qa-rem'),
        eventId,
        occurrence.start,
        new Date(occurrence.start.getTime() - 15 * 3_600_000),
      ]);
    }
  });
}

/** The events of `FIXTURES`: a few days after "now", at fixed hours, in the BDE's zone. */
function addFixtureEvents(context: Context): void {
  const { zone, now } = context;
  const at = (daysAhead: number, hour: number) =>
    fromLocalDateTime({ ...addDays(localDay(now, zone), daysAhead), hour, minute: 0 }, zone);
  const row = (
    id: string,
    title: string,
    author: string,
    status: EventRow['status'],
    daysAhead: number,
    extra: Partial<EventRow> = {},
  ): EventRow => {
    const person = context.people.find((p) => p.login === author);
    if (!person) throw new Error(`fixture author ${author} is not in the dataset`);
    const startsAt = at(daysAhead, 19);
    const createdAt = new Date(now.getTime() - day(3));
    return {
      id,
      title,
      description: 'Event of the quality fixtures.',
      location: 'Salle B',
      categoryKey: 'soiree',
      status,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      repeat: null,
      recurrenceUntil: null,
      schoolYear: schoolYearOf(startsAt, zone),
      confirmationNotifiedAt: status === 'CONFIRMED' ? createdAt : null,
      seriesId: null,
      proposedAt: status === 'PROPOSED' ? new Date(createdAt.getTime() + 3_600_000) : null,
      refusalComment: null,
      refusedByLogin: null,
      refusedAt: null,
      authorLogin: author,
      authorId: person.id,
      createdAt,
      ...extra,
    };
  };
  const events = FIXTURES.events;
  const intraFixtures = [
    [events.intraPending, 'Fixture: to publish on the intra', 16],
    [events.intraPublished, 'Fixture: published on the intra', 17],
    [events.intraOutdated, 'Fixture: to update on the intra', 18],
    [events.intraRefused, 'Fixture: refused by the staff', 19],
  ] as const;
  const series: RepeatRule = { freq: 'WEEKLY', interval: 1, count: 6 };
  const seriesStart = at(20, 18);
  const seriesEnd = new Date(seriesStart.getTime() + 2 * 3_600_000);
  for (const fixture of [
    row(events.confirmed, 'Fixture: published', 'qa-validator', 'CONFIRMED', 10),
    row(events.draft, 'Fixture: draft', 'qa-validator', 'DRAFT', 11),
    row(
      events.proposed,
      'Fixture: proposal of a colleague',
      FIXTURES.accounts.colleague.login,
      'PROPOSED',
      12,
    ),
    row(events.ownDraft, 'Fixture: draft of the proposer', 'qa-proposer', 'DRAFT', 13),
    row(events.ownProposed, 'Fixture: proposal of the proposer', 'qa-proposer', 'PROPOSED', 14),
    row(
      events.ownConfirmed,
      'Fixture: published event of the proposer',
      'qa-proposer',
      'CONFIRMED',
      15,
    ),
    ...intraFixtures.map(([id, title, daysAhead]) =>
      row(id, title, 'qa-validator', 'CONFIRMED', daysAhead),
    ),
    row(events.series, 'Fixture: series', 'qa-validator', 'CONFIRMED', 20, {
      startsAt: seriesStart,
      endsAt: seriesEnd,
      repeat: series,
      recurrenceUntil: endOfCountedRule(series, seriesStart, seriesEnd, zone),
      categoryKey: 'sport',
    }),
  ]) {
    context.events.push(fixture);
  }
}

// ---- the requests to publish on the intra ---------------------------------------------------------------------------------

type IntraRequestState = 'PENDING' | 'PUBLISHED' | 'OUTDATED' | 'REFUSED';

/** The state of the requests of the fixtures, and none for the three that the suites ask for themselves. */
const FIXTURE_REQUESTS: Readonly<Record<string, IntraRequestState>> = {
  [FIXTURES.events.intraPending]: 'PENDING',
  [FIXTURES.events.intraPublished]: 'PUBLISHED',
  [FIXTURES.events.intraOutdated]: 'OUTDATED',
  [FIXTURES.events.intraRefused]: 'REFUSED',
};
const WITHOUT_REQUEST: ReadonlySet<string> = new Set([
  FIXTURES.events.confirmed,
  FIXTURES.events.ownConfirmed,
  FIXTURES.events.series,
]);

/**
 * The requests for the intra of the confirmed events that have its fields: deterministic (drawn from the identifier, never from
 * the generator, so the rest of the dataset does not move), computed with the real rules (the content the staff would be shown, and its
 * hash), in every state, answered by the staff persona. An event of the past is on the intra or has no request. The events with
 * dates of their own or cancelled dates are left out: their content is what the engine says, which the dataset does not repeat here.
 */
function intraRequestRows(context: Context): Value[][] {
  const staff = context.people.find((person) => person.login === 'qa-staff');
  if (!staff) throw new Error('the staff persona is not in the dataset');
  const rows: Value[][] = [];
  for (const event of context.events) {
    const fields = intraFieldsOf(event);
    if (!fields || event.status !== 'CONFIRMED' || WITHOUT_REQUEST.has(event.id)) continue;
    const hasOwn =
      context.cancellations.some((c) => c[1] === event.id) ||
      context.occurrences.some((o) => o[1] === event.id);
    if (hasOwn) continue;
    const source: IntraSource = {
      ...event,
      updatedAt: event.createdAt,
      assignees: [],
      cancellations: [],
      occurrences: [],
      intraOrganizerLogin: fields.organizerLogin,
      intraAudience: fields.audience,
      intraMaxPeople: fields.maxPeople,
      intraWaitingList: fields.waitingList,
      intraKind: fields.kind,
      intraUnsubscribeHours: fields.unsubscribeHours,
      intraKeywords: fields.keywords,
    };
    const readiness = intraReadiness(source, context.zone);
    if (!readiness.ok) continue;

    const pick = hashOf(`intra-request:${event.id}`) % 7;
    const past = event.startsAt.getTime() < context.now.getTime();
    const state: IntraRequestState | null =
      FIXTURE_REQUESTS[event.id] ??
      (past
        ? pick % 2 === 0
          ? 'PUBLISHED'
          : null
        : (
            [null, 'PENDING', 'PUBLISHED', 'PUBLISHED', 'OUTDATED', 'REFUSED', 'PUBLISHED'] as const
          )[pick]!);
    if (!state) continue;

    const id = nextId(context, 'qa-ir');
    const content = readiness.content;
    const requestedAt = new Date(event.createdAt.getTime() + 3_600_000);
    const answeredAt = new Date(requestedAt.getTime() + 2 * 3_600_000);
    const answered = state === 'PENDING' ? null : answeredAt;
    const onIntra = state === 'PUBLISHED' || state === 'OUTDATED';
    // What the intra holds: the content, or, for a request to update, an earlier version of it.
    const published: IntraContent | null = onIntra
      ? state === 'OUTDATED'
        ? { ...content, title: `${content.title} (earlier title)` }
        : content
      : null;
    rows.push([
      id,
      event.id,
      state,
      hashContent(content),
      published ? sqlJson(published) : null,
      published ? answeredAt : null,
      state === 'PUBLISHED' && pick % 2 === 0
        ? `https://profile.intra.42.fr/events/${100_000 + rows.length}`
        : null,
      state === 'REFUSED' ? 'The room is not available on that day: choose another one.' : null,
      requestedAt,
      event.authorLogin,
      event.authorId,
      answered,
      answered ? staff.login : null,
      answered ? staff.id : null,
      requestedAt,
      answered ?? requestedAt,
    ]);
  }
  return rows;
}

// ---- the whole data -------------------------------------------------------------------------------------------------

export function buildDataset(options: DatasetOptions = {}): Dataset {
  const settings = { ...DEFAULTS, ...options };
  const rng = createRandom(settings.seed);
  const { timeZone: zone, now } = settings;
  const script = new Script();

  const people = buildPeople(rng, settings.members, now);
  const owners = people.filter((person) => person.status === 'OWNER');
  const validators = people.filter((person) => person.canValidate && person.status === 'MEMBER');
  const authors = people.filter((person) => person.canPropose && person.status !== 'PENDING');
  const assignable = people.filter((person) => person.status !== 'PENDING');
  const firstOwner = owners[0];
  if (!firstOwner || validators.length === 0 || authors.length === 0) {
    throw new Error('the people of the dataset cannot run the events');
  }

  // Roles the migrations do not create.
  const roles = new Map<string, PersonaRole>();
  for (const role of EXTRA_ROLES) roles.set(role.id, role);
  script.insert(
    'Role',
    ['id', 'name', 'description', 'permissions', 'allPermissions', 'isDefault', 'updatedAt'],
    [...roles.values()].map((role) => [
      role.id,
      role.name,
      role.description,
      sqlTextArray(role.permissions),
      role.allPermissions,
      false,
      now,
    ]),
  );

  script.insert(
    'User',
    [
      'id',
      'login',
      'fullName',
      'email',
      'campus',
      'status',
      'roleId',
      'createdAt',
      'updatedAt',
      'lastLoginAt',
      'calendarToken',
    ],
    people.map((person) => [
      person.id,
      person.login,
      person.fullName,
      person.email,
      person.campus,
      person.status,
      person.roleId,
      person.createdAt,
      person.createdAt,
      person.lastLoginAt,
      person.calendarToken,
    ]),
  );

  const context: Context = {
    rng,
    zone,
    now,
    people,
    validators,
    authors,
    assignable,
    script,
    audit: [],
    events: [],
    assignees: [],
    cancellations: [],
    occurrences: [],
    reminders: [],
    counter: { event: 0, row: 0 },
  };

  // Each account was approved by an owner; the trail starts there.
  for (const person of people) {
    if (person.status !== 'MEMBER') continue;
    context.audit.push({
      id: nextId(context, 'qa-aud'),
      actorLogin: firstOwner.login,
      actorId: firstOwner.id,
      action: 'member.approve',
      targetType: 'User',
      targetId: person.id,
      targetLabel: person.login,
      metadata: { roleId: person.roleId },
      createdAt: new Date(person.createdAt.getTime() + 3_600_000),
    });
  }

  const currentStart = (() => {
    const local = toLocalDateTime(now, zone);
    return local.month >= 9 ? local.year : local.year - 1;
  })();
  for (let offset = settings.schoolYears - 1; offset >= 0; offset -= 1) {
    for (let index = 0; index < settings.eventsPerYear; index += 1) {
      generateEvent(context, currentStart - offset);
    }
  }
  addFixtureEvents(context);
  for (const row of context.events) auditEvent(context, row);
  addTemplates(context);
  const intraRequests = intraRequestRows(context);

  script.insert(
    'Event',
    [
      'id',
      'title',
      'description',
      'location',
      'categoryKey',
      'status',
      'startsAt',
      'endsAt',
      'repeat',
      'recurrenceUntil',
      'schoolYear',
      'confirmationNotifiedAt',
      'seriesId',
      'proposedAt',
      'refusalComment',
      'refusedByLogin',
      'refusedAt',
      'authorLogin',
      'authorId',
      'createdAt',
      'updatedAt',
      'intraOrganizerLogin',
      'intraAudience',
      'intraMaxPeople',
      'intraWaitingList',
      'intraKind',
      'intraUnsubscribeHours',
      'intraKeywords',
    ],
    // A cut series' second row refers to the first: the first is always written first.
    context.events.map((row) => [
      row.id,
      row.title,
      row.description,
      row.location,
      row.categoryKey,
      row.status,
      row.startsAt,
      row.endsAt,
      row.repeat ? sqlJson(row.repeat) : null,
      row.recurrenceUntil,
      row.schoolYear,
      row.confirmationNotifiedAt,
      row.seriesId,
      row.proposedAt,
      row.refusalComment,
      row.refusedByLogin,
      row.refusedAt,
      row.authorLogin,
      row.authorId,
      row.createdAt,
      row.createdAt,
      ...intraValues(row),
    ]),
  );
  script.insert(
    'IntraRequest',
    [
      'id',
      'eventId',
      'status',
      'contentHash',
      'publishedContent',
      'publishedAt',
      'intraUrl',
      'refusalComment',
      'requestedAt',
      'requestedByLogin',
      'requestedById',
      'answeredAt',
      'answeredByLogin',
      'answeredById',
      'createdAt',
      'updatedAt',
    ],
    intraRequests,
  );
  script.insert('EventAssignee', ['id', 'eventId', 'userId', 'login'], context.assignees);
  script.insert(
    'EventCancellation',
    ['id', 'eventId', 'occurrenceStart', 'cancelledByLogin', 'cancelledById'],
    context.cancellations,
  );
  script.insert(
    'EventOccurrence',
    [
      'id',
      'eventId',
      'occurrenceStart',
      'title',
      'description',
      'location',
      'categoryKey',
      'status',
      'startsAt',
      'endsAt',
      'assigneesOverridden',
      'confirmationNotifiedAt',
      'updatedAt',
    ],
    context.occurrences,
  );
  script.insert('EventReminder', ['id', 'eventId', 'occurrenceStart', 'sentAt'], context.reminders);
  script.insert(
    'AuditLog',
    [
      'id',
      'actorLogin',
      'actorId',
      'action',
      'targetType',
      'targetId',
      'targetLabel',
      'metadata',
      'createdAt',
    ],
    context.audit
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((entry) => [
        entry.id,
        entry.actorLogin,
        entry.actorId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.targetLabel,
        sqlJson(entry.metadata),
        entry.createdAt,
      ]),
  );

  return { sql: script.toString(), stats: { ...script.counts } };
}
