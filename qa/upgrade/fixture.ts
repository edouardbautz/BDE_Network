/**
 * What an old installation holds: written in the SCHEMA OF THE OLD VERSION (columns that exist in 1.0.0, so that it loads in every
 * version from 1.0.0 on), as an operator's database would be after a few months: roles (one of them with the right the update
 * converts), members and a person waiting, a calendar link of the BDE and of two members, and events of every kind the old
 * versions knew: single, weekly, every two weeks, monthly (on a day that short months do not have), a draft, a date cancelled and,
 * from 1.1.0 on, a date moved and renamed. The series cross the change of clock of the end of March 2027, so a date whose hour
 * moved would show.
 *
 * The data is loaded into the old version's database, after the old version started (its migrations applied) and before the
 * update; nothing in the new schema is written here.
 */

export const OLD = {
  owner: 'qa-owner',
  admin: 'upg-admin',
  treasurer: 'upg-treasurer',
  reader: 'upg-reader',
  member: 'upg-member',
  pending: 'upg-pending',
  /** The tokens of the calendar links: 43 characters of the URL-safe alphabet, as the platform makes them. */
  tokens: {
    member: `member-${'A'.repeat(36)}`,
    treasurer: `treasurer-${'B'.repeat(33)}`,
    bde: `bde-${'C'.repeat(39)}`,
  },
  /** A role the update converts (events.manage) and one it leaves alone. */
  roles: { treasurer: 'Trésorier', reader: 'Lecteur' },
} as const;

const q = (text: string) => `'${text.replace(/'/g, "''")}'`;

const USERS: {
  login: string;
  name: string;
  status: string;
  role: string | null;
  token?: string;
}[] = [
  { login: OLD.owner, name: 'QA Owner', status: 'OWNER', role: null },
  { login: OLD.admin, name: 'Upg Admin', status: 'MEMBER', role: 'role-admin' },
  {
    login: OLD.treasurer,
    name: 'Upg Treasurer',
    status: 'MEMBER',
    role: 'role-upg-treasurer',
    token: OLD.tokens.treasurer,
  },
  { login: OLD.reader, name: 'Upg Reader', status: 'MEMBER', role: 'role-upg-reader' },
  {
    login: OLD.member,
    name: 'Upg Member',
    status: 'MEMBER',
    role: 'role-member',
    token: OLD.tokens.member,
  },
  { login: OLD.pending, name: 'Upg Pending', status: 'PENDING', role: null },
];

interface OldEvent {
  id: string;
  title: string;
  status: 'DRAFT' | 'CONFIRMED';
  recurrence: 'NONE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  startsAt: string;
  endsAt: string;
  until: string | null;
  category: string;
}

// UTC. In Paris the clocks go forward on 2027-03-28: "20:00 on Wednesdays" is 19:00Z before, 18:00Z after.
export const EVENTS: OldEvent[] = [
  {
    id: 'upg-e1',
    title: 'Soirée de rentrée',
    status: 'CONFIRMED',
    recurrence: 'NONE',
    startsAt: '2027-03-02T18:00:00Z',
    endsAt: '2027-03-02T20:00:00Z',
    until: null,
    category: 'soiree',
  },
  {
    id: 'upg-e2',
    title: 'Soirée jeux hebdomadaire',
    status: 'CONFIRMED',
    recurrence: 'WEEKLY',
    startsAt: '2027-03-03T19:00:00Z',
    endsAt: '2027-03-03T21:00:00Z',
    until: '2027-04-07T23:59:00Z',
    category: 'soiree',
  },
  {
    id: 'upg-e3',
    title: 'Réunion du bureau',
    status: 'CONFIRMED',
    recurrence: 'BIWEEKLY',
    startsAt: '2027-02-04T18:30:00Z',
    endsAt: '2027-02-04T19:30:00Z',
    until: '2027-04-01T23:59:00Z',
    category: 'partenariat',
  },
  {
    id: 'upg-e4',
    title: 'Permanence du 31',
    status: 'CONFIRMED',
    recurrence: 'MONTHLY',
    startsAt: '2027-01-31T18:00:00Z',
    endsAt: '2027-01-31T19:00:00Z',
    until: '2027-06-30T23:59:00Z',
    category: 'sport',
  },
  {
    id: 'upg-e5',
    title: 'Brouillon de sortie',
    status: 'DRAFT',
    recurrence: 'NONE',
    startsAt: '2027-03-15T17:00:00Z',
    endsAt: '2027-03-15T19:00:00Z',
    until: null,
    category: 'wei',
  },
  {
    id: 'upg-e6',
    title: 'Entraînement du mercredi',
    status: 'CONFIRMED',
    recurrence: 'WEEKLY',
    startsAt: '2027-05-05T17:00:00Z',
    endsAt: '2027-05-05T18:30:00Z',
    until: '2027-06-09T23:59:00Z',
    category: 'sport',
  },
];

/** The second date of the weekly series of training, cancelled; the third, moved and renamed (from 1.1.0). */
export const CANCELLED = '2027-05-12T17:00:00Z';
export const MOVED = '2027-05-19T17:00:00Z';

/** `true` when the old version has the table of dates of a series' own (1.1.0 and 1.2.0). */
export function fixtureSql(options: { occurrences: boolean }): string {
  const lines: string[] = ['BEGIN;'];

  lines.push(
    `INSERT INTO "Role" ("id","name","description","permissions","allPermissions","isDefault","updatedAt") VALUES
  ('role-upg-treasurer', ${q(OLD.roles.treasurer)}, 'Finances et événements', ARRAY['events.view','events.manage','members.manage'], false, false, now()),
  ('role-upg-reader', ${q(OLD.roles.reader)}, 'Lecture seule', ARRAY['events.view'], false, false, now());`,
  );

  for (const user of USERS) {
    lines.push(
      `INSERT INTO "User" ("id","login","fullName","email","campus","status","roleId","calendarToken","createdAt","updatedAt","lastLoginAt")
  VALUES (${q(`user-${user.login}`)}, ${q(user.login)}, ${q(user.name)}, ${q(`${user.login}@student.42.fr`)}, 'Paris', ${q(user.status)}, ${user.role ? q(user.role) : 'NULL'}, ${user.token ? q(user.token) : 'NULL'}, now() - interval '90 days', now(), now() - interval '2 days');`,
    );
  }

  for (const event of EVENTS) {
    lines.push(
      `INSERT INTO "Event" ("id","title","description","location","categoryKey","status","startsAt","endsAt","recurrence","recurrenceUntil","schoolYear","authorLogin","authorId","createdAt","updatedAt")
  VALUES (${q(event.id)}, ${q(event.title)}, 'Écrit pour la mise à jour', 'Salle B', ${q(event.category)}, ${q(event.status)}, ${q(event.startsAt)}, ${q(event.endsAt)}, ${q(event.recurrence)}, ${event.until ? q(event.until) : 'NULL'}, '2026-2027', ${q(OLD.treasurer)}, ${q(`user-${OLD.treasurer}`)}, now() - interval '30 days', now());`,
    );
  }

  lines.push(
    `INSERT INTO "EventAssignee" ("id","eventId","userId","login") VALUES
  ('upg-a1', 'upg-e1', ${q(`user-${OLD.member}`)}, ${q(OLD.member)}),
  ('upg-a2', 'upg-e6', ${q(`user-${OLD.reader}`)}, ${q(OLD.reader)});`,
    `INSERT INTO "EventCancellation" ("id","eventId","occurrenceStart","cancelledByLogin","cancelledById")
  VALUES ('upg-c1', 'upg-e6', ${q(CANCELLED)}, ${q(OLD.treasurer)}, ${q(`user-${OLD.treasurer}`)});`,
    `INSERT INTO "EventReminder" ("id","eventId","occurrenceStart") VALUES ('upg-r1', 'upg-e1', '2027-03-02T18:00:00Z');`,
    `INSERT INTO "BdeCalendarFeed" ("id","token","updatedAt") VALUES ('bde', ${q(OLD.tokens.bde)}, now())
  ON CONFLICT ("id") DO UPDATE SET "token" = EXCLUDED."token";`,
    `INSERT INTO "AuditLog" ("id","actorLogin","actorId","action","targetType","targetId","targetLabel","createdAt") VALUES
  ('upg-l1', ${q(OLD.treasurer)}, ${q(`user-${OLD.treasurer}`)}, 'event.create', 'Event', 'upg-e1', 'Soirée de rentrée', now() - interval '29 days'),
  ('upg-l2', ${q(OLD.owner)}, ${q(`user-${OLD.owner}`)}, 'member.approve', 'User', ${q(`user-${OLD.member}`)}, ${q(OLD.member)}, now() - interval '28 days'),
  ('upg-l3', ${q(OLD.owner)}, ${q(`user-${OLD.owner}`)}, 'role.create', 'Role', 'role-upg-treasurer', ${q(OLD.roles.treasurer)}, now() - interval '27 days');`,
  );

  if (options.occurrences) {
    lines.push(
      `INSERT INTO "EventOccurrence" ("id","eventId","occurrenceStart","title","startsAt","endsAt","updatedAt")
  VALUES ('upg-o1', 'upg-e6', ${q(MOVED)}, 'Entraînement déplacé', '2027-05-19T18:00:00Z', '2027-05-19T19:30:00Z', now());`,
    );
  }

  lines.push('COMMIT;');
  return lines.join('\n');
}

/** The tables whose rows are counted before and after, and the ones a version may not have. */
export const COUNTED_TABLES = [
  'Role',
  'User',
  'Event',
  'EventAssignee',
  'EventCancellation',
  'EventReminder',
  'BdeCalendarFeed',
  'AuditLog',
] as const;
export const OCCURRENCE_TABLES = ['EventOccurrence', 'EventOccurrenceAssignee'] as const;
