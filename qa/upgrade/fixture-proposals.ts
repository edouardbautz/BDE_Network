/**
 * What a BDE of version 1.3.0 or 1.4.0 holds, written in THEIR schema (the one `prisma/schema.prisma` has had since the proposal
 * circuit and the repeat rules: no migration came after), as a board would have it after a term: a role that only proposes, one
 * that validates, one that manages the shared calendar; series with rules that the first versions did not know (every two weeks on
 * Monday and Wednesday, ten times, across the change of clock; the second Saturday of the month; the last day of the month;
 * every year), one series cut in two with a date cancelled and one moved and given other people in charge; a proposal, a proposal
 * of a series, a refusal with its comment, a draft, and a series still a draft whose one date was confirmed alone.
 *
 * Loaded into the old version's database after it started and before the update, like `fixture.ts` (which is the schema of 1.0.0 to
 * 1.2.0). The dates are in 2027, and after the change of clock of 28 March, so a date whose hour moved would show; they must be moved
 * before 2027-01-30, when the first reminder falls due, as those of `fixture.ts` must.
 */

export const CURRENT = {
  owner: 'qa-owner',
  admin: 'upg-admin',
  proposer: 'upg-proposer',
  validator: 'upg-validator',
  shared: 'upg-shared',
  member: 'upg-member',
  pending: 'upg-pending',
  /** The tokens of the calendar links: 43 characters of the URL-safe alphabet, as the platform makes them. */
  tokens: {
    member: `member-${'A'.repeat(36)}`,
    proposer: `proposer-${'B'.repeat(34)}`,
    validator: `validator-${'C'.repeat(33)}`,
    bde: `bde-${'D'.repeat(39)}`,
  },
  roles: { proposer: 'Proposeur', validator: 'Validateur', shared: 'Agenda partagé' },
  /** The words of the refusal, which the author must still read after the update. */
  refusalComment:
    "Le budget n'est pas voté : on en reparle à la prochaine réunion.\nMerci de proposer une date plus tard.",
  events: {
    refused: 'upg2-e10',
    proposal: 'upg2-e8',
    proposalSeries: 'upg2-e9',
  },
} as const;

const q = (text: string) => `'${text.replace(/'/g, "''")}'`;

const USERS: {
  login: string;
  name: string;
  status: string;
  role: string | null;
  token?: string;
}[] = [
  { login: CURRENT.owner, name: 'QA Owner', status: 'OWNER', role: null },
  { login: CURRENT.admin, name: 'Upg Admin', status: 'MEMBER', role: 'role-admin' },
  {
    login: CURRENT.proposer,
    name: 'Upg Proposer',
    status: 'MEMBER',
    role: 'role-upg-proposer',
    token: CURRENT.tokens.proposer,
  },
  {
    login: CURRENT.validator,
    name: 'Upg Validator',
    status: 'MEMBER',
    role: 'role-upg-validator',
    token: CURRENT.tokens.validator,
  },
  { login: CURRENT.shared, name: 'Upg Shared', status: 'MEMBER', role: 'role-upg-shared' },
  {
    login: CURRENT.member,
    name: 'Upg Member',
    status: 'MEMBER',
    role: 'role-member',
    token: CURRENT.tokens.member,
  },
  { login: CURRENT.pending, name: 'Upg Pending', status: 'PENDING', role: null },
];

type Status = 'DRAFT' | 'PROPOSED' | 'CONFIRMED';

export interface CurrentEvent {
  id: string;
  title: string;
  status: Status;
  /** UTC. In Paris the clocks go forward on 2027-03-28: "20:00" is 19:00Z before, 18:00Z after. */
  startsAt: string;
  endsAt: string;
  repeat: Record<string, unknown> | null;
  /** The end date typed (23:59 local), or, for a rule that ends after N dates, the start of the last one. */
  until: string | null;
  category: string;
  author: string;
  seriesId?: string;
  /** Days ago, for the events that were proposed. */
  proposedDaysAgo?: number;
  refused?: boolean;
  announced?: boolean;
}

export const CURRENT_EVENTS: CurrentEvent[] = [
  {
    id: 'upg2-e1',
    title: 'Soirée de rentrée',
    status: 'CONFIRMED',
    startsAt: '2027-03-02T18:00:00Z',
    endsAt: '2027-03-02T20:00:00Z',
    repeat: null,
    until: null,
    category: 'soiree',
    author: CURRENT.validator,
    announced: true,
  },
  {
    // Mondays and Wednesdays, every two weeks, ten times: 1 and 3 February, 15 and 17, 1 and 3 March, 15 and 17, 29 and 31 March
    // (the last two after the change of clock, so 18:00Z instead of 19:00Z).
    id: 'upg2-e2',
    title: 'Réunion du lundi et du mercredi',
    status: 'CONFIRMED',
    startsAt: '2027-02-01T19:00:00Z',
    endsAt: '2027-02-01T21:00:00Z',
    repeat: { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 },
    until: '2027-03-31T18:00:00Z',
    category: 'partenariat',
    author: CURRENT.validator,
    announced: true,
  },
  {
    id: 'upg2-e3',
    title: 'Sortie du deuxième samedi',
    status: 'CONFIRMED',
    startsAt: '2027-02-13T15:00:00Z',
    endsAt: '2027-02-13T17:00:00Z',
    repeat: { freq: 'MONTHLY', interval: 1, monthly: { kind: 'nth', nth: 2, weekday: 'SA' } },
    until: '2027-06-30T21:59:00Z',
    category: 'sport',
    author: CURRENT.validator,
  },
  {
    id: 'upg2-e4',
    title: 'Permanence de fin de mois',
    status: 'CONFIRMED',
    startsAt: '2027-02-28T17:00:00Z',
    endsAt: '2027-02-28T18:00:00Z',
    repeat: { freq: 'MONTHLY', interval: 1, monthly: { kind: 'lastDay' } },
    until: '2027-06-30T21:59:00Z',
    category: 'sport',
    author: CURRENT.validator,
  },
  {
    id: 'upg2-e5',
    title: 'Gala annuel',
    status: 'CONFIRMED',
    startsAt: '2027-02-20T19:00:00Z',
    endsAt: '2027-02-20T23:00:00Z',
    repeat: { freq: 'YEARLY', interval: 1 },
    until: '2029-12-31T22:59:00Z',
    category: 'soiree',
    author: CURRENT.validator,
  },
  {
    // A series cut in two rows at its fourth date: three dates in the first, three in the second, which keeps the first's id as
    // its `seriesId` (so no date changes its identifier in a calendar).
    id: 'upg2-e6',
    title: 'Entraînement du mercredi',
    status: 'CONFIRMED',
    startsAt: '2027-05-05T17:00:00Z',
    endsAt: '2027-05-05T18:30:00Z',
    repeat: { freq: 'WEEKLY', interval: 1, weekdays: ['WE'], count: 3 },
    until: '2027-05-19T17:00:00Z',
    category: 'sport',
    author: CURRENT.validator,
  },
  {
    id: 'upg2-e6-b',
    title: 'Entraînement du mercredi',
    status: 'CONFIRMED',
    startsAt: '2027-05-26T17:00:00Z',
    endsAt: '2027-05-26T18:30:00Z',
    repeat: { freq: 'WEEKLY', interval: 1, weekdays: ['WE'], count: 3 },
    until: '2027-06-09T17:00:00Z',
    category: 'sport',
    author: CURRENT.validator,
    seriesId: 'upg2-e6',
  },
  {
    // Still a draft (its author proposes events, and nobody has published it), except for one date a validator confirmed alone.
    id: 'upg2-e7',
    title: 'Tournoi du mercredi',
    status: 'DRAFT',
    startsAt: '2027-04-07T17:00:00Z',
    endsAt: '2027-04-07T19:00:00Z',
    repeat: { freq: 'WEEKLY', interval: 1, weekdays: ['WE'], count: 4 },
    until: '2027-04-28T17:00:00Z',
    category: 'sport',
    author: CURRENT.proposer,
  },
  {
    id: CURRENT.events.proposal,
    title: 'Afterwork partenaires',
    status: 'PROPOSED',
    startsAt: '2027-04-20T16:00:00Z',
    endsAt: '2027-04-20T18:00:00Z',
    repeat: null,
    until: null,
    category: 'partenariat',
    author: CURRENT.proposer,
    proposedDaysAgo: 3,
  },
  {
    id: CURRENT.events.proposalSeries,
    title: 'Atelier cuisine du jeudi',
    status: 'PROPOSED',
    startsAt: '2027-05-06T16:00:00Z',
    endsAt: '2027-05-06T18:00:00Z',
    repeat: { freq: 'WEEKLY', interval: 1, weekdays: ['TH'], count: 5 },
    until: '2027-06-03T16:00:00Z',
    category: 'soiree',
    author: CURRENT.proposer,
    proposedDaysAgo: 1,
  },
  {
    id: CURRENT.events.refused,
    title: 'Voyage surprise',
    status: 'DRAFT',
    startsAt: '2027-04-24T07:00:00Z',
    endsAt: '2027-04-24T17:00:00Z',
    repeat: null,
    until: null,
    category: 'wei',
    author: CURRENT.proposer,
    proposedDaysAgo: 6,
    refused: true,
  },
  {
    id: 'upg2-e11',
    title: 'Brouillon de sortie',
    status: 'DRAFT',
    startsAt: '2027-03-15T17:00:00Z',
    endsAt: '2027-03-15T19:00:00Z',
    repeat: null,
    until: null,
    category: 'wei',
    author: CURRENT.proposer,
  },
];

/** The dates a series has of its own: one cancelled, one moved (with other people in charge), one confirmed alone. */
export const CURRENT_DATES = {
  cancelled: { event: 'upg2-e5', start: '2028-02-20T19:00:00Z' },
  cancelledTraining: { event: 'upg2-e6', start: '2027-05-12T17:00:00Z' },
  moved: {
    event: 'upg2-e6-b',
    start: '2027-06-02T17:00:00Z',
    startsAt: '2027-06-02T18:00:00Z',
    endsAt: '2027-06-02T19:30:00Z',
  },
  confirmedAlone: { event: 'upg2-e7', start: '2027-04-14T17:00:00Z' },
} as const;

export function fixtureSqlCurrent(): string {
  const lines: string[] = ['BEGIN;'];
  const who = (login: string) => q(`user-${login}`);

  lines.push(
    `INSERT INTO "Role" ("id","name","description","permissions","allPermissions","isDefault","updatedAt") VALUES
  ('role-upg-proposer', ${q(CURRENT.roles.proposer)}, 'Propose des événements', ARRAY['events.view','events.propose'], false, false, now()),
  ('role-upg-validator', ${q(CURRENT.roles.validator)}, 'Valide les événements', ARRAY['events.view','events.propose','events.validate'], false, false, now()),
  ('role-upg-shared', ${q(CURRENT.roles.shared)}, 'Gère l''agenda partagé', ARRAY['events.view','events.shared_calendar'], false, false, now());`,
  );

  for (const user of USERS) {
    lines.push(
      `INSERT INTO "User" ("id","login","fullName","email","campus","status","roleId","calendarToken","createdAt","updatedAt","lastLoginAt")
  VALUES (${who(user.login)}, ${q(user.login)}, ${q(user.name)}, ${q(`${user.login}@student.42.fr`)}, 'Paris', ${q(user.status)}, ${user.role ? q(user.role) : 'NULL'}, ${user.token ? q(user.token) : 'NULL'}, now() - interval '90 days', now(), now() - interval '2 days');`,
    );
  }

  for (const event of CURRENT_EVENTS) {
    const proposed = event.proposedDaysAgo !== undefined;
    lines.push(
      `INSERT INTO "Event" ("id","title","description","location","categoryKey","status","startsAt","endsAt","repeat","recurrenceUntil","schoolYear","confirmationNotifiedAt","seriesId","proposedAt","refusalComment","refusedByLogin","refusedAt","authorLogin","authorId","createdAt","updatedAt")
  VALUES (${q(event.id)}, ${q(event.title)}, 'Écrit pour la mise à jour', 'Salle B', ${q(event.category)}, ${q(event.status)}, ${q(event.startsAt)}, ${q(event.endsAt)}, ${event.repeat ? `${q(JSON.stringify(event.repeat))}::jsonb` : 'NULL'}, ${event.until ? q(event.until) : 'NULL'}, '2026-2027', ${event.announced ? "now() - interval '20 days'" : 'NULL'}, ${event.seriesId ? q(event.seriesId) : 'NULL'}, ${proposed ? `now() - interval '${event.proposedDaysAgo} days'` : 'NULL'}, ${event.refused ? q(CURRENT.refusalComment) : 'NULL'}, ${event.refused ? q(CURRENT.validator) : 'NULL'}, ${event.refused ? "now() - interval '5 days'" : 'NULL'}, ${q(event.author)}, ${who(event.author)}, now() - interval '30 days', now());`,
    );
  }

  const { cancelled, cancelledTraining, moved, confirmedAlone } = CURRENT_DATES;
  lines.push(
    `INSERT INTO "EventAssignee" ("id","eventId","userId","login") VALUES
  ('upg2-a1', 'upg2-e1', ${who(CURRENT.member)}, ${q(CURRENT.member)}),
  ('upg2-a2', 'upg2-e6-b', ${who(CURRENT.member)}, ${q(CURRENT.member)}),
  ('upg2-a3', 'upg2-e6-b', ${who(CURRENT.validator)}, ${q(CURRENT.validator)});`,
    `INSERT INTO "EventCancellation" ("id","eventId","occurrenceStart","cancelledByLogin","cancelledById") VALUES
  ('upg2-c1', ${q(cancelled.event)}, ${q(cancelled.start)}, ${q(CURRENT.validator)}, ${who(CURRENT.validator)}),
  ('upg2-c2', ${q(cancelledTraining.event)}, ${q(cancelledTraining.start)}, ${q(CURRENT.validator)}, ${who(CURRENT.validator)});`,
    `INSERT INTO "EventReminder" ("id","eventId","occurrenceStart") VALUES
  ('upg2-r1', 'upg2-e1', '2027-03-02T18:00:00Z'),
  ('upg2-r2', 'upg2-e6', '2027-05-05T17:00:00Z');`,
    `INSERT INTO "EventOccurrence" ("id","eventId","occurrenceStart","title","startsAt","endsAt","assigneesOverridden","updatedAt")
  VALUES ('upg2-o1', ${q(moved.event)}, ${q(moved.start)}, 'Entraînement déplacé', ${q(moved.startsAt)}, ${q(moved.endsAt)}, true, now());`,
    `INSERT INTO "EventOccurrenceAssignee" ("id","occurrenceId","userId","login") VALUES
  ('upg2-oa1', 'upg2-o1', ${who(CURRENT.member)}, ${q(CURRENT.member)});`,
    `INSERT INTO "EventOccurrence" ("id","eventId","occurrenceStart","status","confirmationNotifiedAt","updatedAt")
  VALUES ('upg2-o2', ${q(confirmedAlone.event)}, ${q(confirmedAlone.start)}, 'CONFIRMED', now() - interval '4 days', now());`,
    `INSERT INTO "BdeCalendarFeed" ("id","token","updatedAt") VALUES ('bde', ${q(CURRENT.tokens.bde)}, now())
  ON CONFLICT ("id") DO UPDATE SET "token" = EXCLUDED."token";`,
    `INSERT INTO "AuditLog" ("id","actorLogin","actorId","action","targetType","targetId","targetLabel","metadata","createdAt") VALUES
  ('upg2-l1', ${q(CURRENT.owner)}, ${who(CURRENT.owner)}, 'role.create', 'Role', 'role-upg-proposer', ${q(CURRENT.roles.proposer)}, NULL, now() - interval '40 days'),
  ('upg2-l2', ${q(CURRENT.owner)}, ${who(CURRENT.owner)}, 'role.create', 'Role', 'role-upg-validator', ${q(CURRENT.roles.validator)}, NULL, now() - interval '40 days'),
  ('upg2-l3', ${q(CURRENT.owner)}, ${who(CURRENT.owner)}, 'member.approve', 'User', ${who(CURRENT.proposer)}, ${q(CURRENT.proposer)}, NULL, now() - interval '39 days'),
  ('upg2-l4', ${q(CURRENT.validator)}, ${who(CURRENT.validator)}, 'event.create', 'Event', 'upg2-e2', 'Réunion du lundi et du mercredi', NULL, now() - interval '30 days'),
  ('upg2-l5', ${q(CURRENT.proposer)}, ${who(CURRENT.proposer)}, 'event.create', 'Event', ${q(CURRENT.events.proposal)}, 'Afterwork partenaires', NULL, now() - interval '3 days'),
  ('upg2-l6', ${q(CURRENT.proposer)}, ${who(CURRENT.proposer)}, 'event.propose', 'Event', ${q(CURRENT.events.proposal)}, 'Afterwork partenaires', NULL, now() - interval '3 days'),
  ('upg2-l7', ${q(CURRENT.validator)}, ${who(CURRENT.validator)}, 'event.refuse', 'Event', ${q(CURRENT.events.refused)}, 'Voyage surprise', ${q(JSON.stringify({ comment: CURRENT.refusalComment, author: CURRENT.proposer }))}::jsonb, now() - interval '5 days');`,
  );

  lines.push('COMMIT;');
  return lines.join('\n');
}
