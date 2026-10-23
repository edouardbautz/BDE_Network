import { FIXTURES } from '../dataset';
import type { PersonaKey, PlatformVariant } from '../personas';
import type { Queryable } from '../invariants';
import { can, isOwner } from './model';

/**
 * Who may call each server action, as the matrix holds the platform to it. A server action is a public HTTP entry
 * point: hiding a button protects nothing, the action must refuse by itself. `actions-run.ts` calls every action, as
 * every persona, over HTTP the way the browser does; a persona that must be refused changes nothing in the database
 * and gets no success, and the least privileged persona that is allowed gets through (so that an action that refuses
 * everybody, or that the matrix feeds wrong arguments, does not pass as "secure").
 *
 * One entry is a CASE: the same action can have several (a proposer may edit their own draft, not a published event).
 */

export interface Context {
  /** The first date of the series fixture, in milliseconds (UTC): the dates are a week apart. */
  seriesStart: number;
}

export interface ActionCase {
  /** `<folder>.<action>`, the name `discover.ts` gives. */
  action: string;
  /** What this case is. */
  label: string;
  /** Whether this persona is allowed to do it, on a platform run in this variant. */
  allowed(who: PersonaKey, variant: PlatformVariant): boolean;
  /** The arguments, as the page would pass them (a FormData where the page sends a form). */
  args(context: Context): unknown[];
  /** What the database must hold before the call, on top of the dataset (a cancelled date, a feed link…). */
  prepare?(db: Queryable, context: Context): Promise<void>;
  /** A refusal must be an error status (a throw is a 500, the installer's "not found" a 404), not just "nothing happened": the gate comes before everything. */
  strictThrow?: boolean;
  /** What an allowed persona shows: the database changes (default), or the action merely answers without throwing. */
  control?: 'changes' | 'answers';
  /** The tables that must change when an allowed persona does it (the audit log among them, for what is audited). */
  effect?: readonly string[];
}

const WEEK = 7 * 86_400_000;

const nobody = () => false;
const events = FIXTURES.events;

/** The form of an event, as the page sends it. */
export function eventForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields: Record<string, string> = {
    title: 'Created by the access matrix',
    description: 'Written by a test',
    location: 'Salle B',
    categoryKey: 'soiree',
    startsAt: '2026-12-20T20:00',
    endsAt: '2026-12-20T22:00',
    repeat: 'NONE',
    repeatEnd: 'until',
    recurrenceUntil: '',
    repeatFreq: 'WEEKLY',
    repeatInterval: '1',
    repeatMonthly: 'day',
    repeatMonthDay: '',
    repeatCount: '10',
    status: 'DRAFT',
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}

function roleForm(name: string): FormData {
  const form = new FormData();
  form.append('name', name);
  form.append('description', 'Made by the access matrix');
  // a right of the core, which exists whether the events module is on or off
  form.append('permissions', 'members.manage');
  return form;
}

const mayPropose = (who: PersonaKey, variant: PlatformVariant) =>
  can(who, 'events.propose', variant) || can(who, 'events.validate', variant);
const validates = (who: PersonaKey, variant: PlatformVariant) =>
  can(who, 'events.validate', variant);
const members = (who: PersonaKey) => can(who, 'members.manage');
const roles = (who: PersonaKey) => can(who, 'roles.manage');
const templates = (who: PersonaKey) => can(who, 'notifications.templates');
const sharesCalendar = (who: PersonaKey, variant: PlatformVariant) =>
  can(who, 'events.shared_calendar', variant);

/** The actions of the settings page: the owner's, whatever they are given; the gate is the first thing they do. */
const OWNER_ONLY_SETTINGS = [
  ['saveIdentity', [{}]],
  ['saveLogo', [new FormData()]],
  ['removeLogo', []],
  ['saveEvents', [{}]],
  ['saveAddress', [{}]],
  ['verifyFortyTwo', [{}]],
  ['skipFortyTwoVerification', [{}]],
  ['loadCampuses', []],
  ['saveCampuses', [{}]],
  ['checkOwner', ['nobody-at-all']],
  ['addOwner', [{}]],
  ['removeOwner', [{}]],
  ['saveModules', [{}]],
  ['saveUpdates', [{}]],
  ['saveNotifications', [{}]],
  ['testNotification', [{}]],
] as const;

/** The actions of the installer: it is over once the platform is installed, for everybody. */
const INSTALLER = [
  'submitCode',
  'saveIdentity',
  'saveAddress',
  'verifyFortyTwo',
  'skipFortyTwoVerification',
  'loadCampuses',
  'saveCampuses',
  'checkOwner',
  'saveOwners',
  'saveModules',
  'saveNotifications',
  'testNotification',
  'finishInstallation',
] as const;

/** A template of the members' notifications, written as the page would, for the cases that need one to act on. */
const TEMPLATE_ID = 'qa-template-prepared';
const prepareTemplate = async (db: Queryable) => {
  await db.query(
    `INSERT INTO "NotificationTemplate" ("id", "type", "scope", "content", "version", "basedOnRevision", "updatedAt", "updatedByLogin") VALUES ($1, 'memberPending', 'all', '{"eyebrow":"Prepared"}'::jsonb, 2, 1, now(), 'qa-admin') ON CONFLICT DO NOTHING`,
    [TEMPLATE_ID],
  );
  await db.query(
    `INSERT INTO "NotificationTemplateVersion" ("id", "type", "scope", "version", "content", "basedOnRevision", "action", "authorLogin") VALUES ('qa-version-1', 'memberPending', 'all', 1, '{"eyebrow":"First"}'::jsonb, 1, 'save', 'qa-admin'), ('qa-version-2', 'memberPending', 'all', 2, '{"eyebrow":"Prepared"}'::jsonb, 1, 'save', 'qa-admin') ON CONFLICT DO NOTHING`,
  );
};
const TEMPLATE_TABLES = [
  'NotificationTemplate',
  'NotificationTemplateVersion',
  'AuditLog',
] as const;

const TEMPLATE_CASES: readonly ActionCase[] = [
  {
    action: 'notifications.saveTemplate',
    label: 'write a template for all channels',
    effect: TEMPLATE_TABLES,
    allowed: templates,
    args: () => [
      {
        type: 'memberPending',
        scope: 'all',
        content: { eyebrow: 'Written by the access matrix' },
        expectedVersion: 0,
      },
    ],
    strictThrow: true,
  },
  {
    action: 'notifications.customizeChannel',
    label: 'make a channel different from the others',
    effect: TEMPLATE_TABLES,
    allowed: templates,
    args: () => [{ type: 'memberPending', channel: 'slack' }],
    strictThrow: true,
  },
  {
    action: 'notifications.resetTemplate',
    label: 'put one tab back as the platform writes it',
    effect: TEMPLATE_TABLES,
    allowed: templates,
    prepare: prepareTemplate,
    args: () => [{ type: 'memberPending', scope: 'all' }],
    strictThrow: true,
  },
  {
    action: 'notifications.resetNotification',
    label: 'put a whole notification back as the platform writes it',
    effect: TEMPLATE_TABLES,
    allowed: templates,
    prepare: prepareTemplate,
    args: () => [{ type: 'memberPending' }],
    strictThrow: true,
  },
  {
    action: 'notifications.restoreVersion',
    label: 'restore an older version',
    effect: TEMPLATE_TABLES,
    allowed: templates,
    prepare: prepareTemplate,
    args: () => [{ type: 'memberPending', scope: 'all', version: 1 }],
    strictThrow: true,
  },
  {
    action: 'notifications.acknowledgeRevision',
    label: 'mark the improvements of the platform as seen',
    effect: ['NotificationTemplate', 'AuditLog'],
    allowed: templates,
    prepare: prepareTemplate,
    args: () => [{ type: 'memberPending', scope: 'all' }],
    strictThrow: true,
  },
  {
    action: 'notifications.addMention',
    label: 'add somebody to mention',
    effect: ['NotificationMention', 'AuditLog'],
    allowed: templates,
    args: () => [
      {
        platform: 'discord',
        kind: 'role',
        key: 'qa-matrix',
        label: 'Added by the access matrix',
        externalId: '123456789012345678',
      },
    ],
    strictThrow: true,
  },
  {
    action: 'notifications.removeMention',
    label: 'take somebody off the list to mention',
    effect: ['NotificationMention', 'AuditLog'],
    allowed: templates,
    prepare: async (db) => {
      await db.query(
        `INSERT INTO "NotificationMention" ("id", "key", "platform", "kind", "label", "externalId", "createdByLogin") VALUES ('qa-mention-prepared', 'qa-prepared', 'discord', 'role', 'Prepared', '123456789012345678', 'qa-admin') ON CONFLICT DO NOTHING`,
      );
    },
    args: () => [{ id: 'qa-mention-prepared' }],
    strictThrow: true,
  },
  {
    action: 'notifications.previewTemplate',
    label: 'draw a notification with what is typed (reads only)',
    allowed: templates,
    args: () => [{ type: 'memberPending', channel: 'discord', drafts: {} }],
    strictThrow: true,
    control: 'answers',
  },
  {
    action: 'notifications.sendTemplateTestMessage',
    label: 'send a test message (no channel is set up on the platform: nothing leaves)',
    allowed: templates,
    args: () => [{ type: 'memberPending', channel: 'discord', drafts: {}, withMentions: false }],
    strictThrow: true,
    control: 'answers',
  },
  {
    action: 'notifications.loadHistory',
    label: 'read the versions of a template (reads only)',
    allowed: templates,
    args: () => [{ type: 'memberPending', scope: 'all' }],
    strictThrow: true,
    control: 'answers',
  },
];

export const CASES: readonly ActionCase[] = [
  // ---- the members ----
  {
    action: 'members.approveMember',
    label: 'approve an account with the default role',
    effect: ['User', 'AuditLog'],
    allowed: members,
    args: () => [FIXTURES.accounts.applicant.id, 'role-member'],
  },
  {
    action: 'members.approveMember',
    label: 'approve an account with the Admin role (a right the approver may not hold)',
    effect: ['User', 'AuditLog'],
    // Nobody hands out what they do not hold: the member who manages members cannot make an Admin.
    allowed: (who) => who === 'admin' || who === 'owner',
    args: () => [FIXTURES.accounts.applicant.id, 'role-admin'],
  },
  {
    action: 'members.rejectMember',
    label: 'refuse an account',
    effect: ['User', 'AuditLog'],
    allowed: members,
    args: () => [FIXTURES.accounts.applicant.id],
  },
  {
    action: 'members.removeMember',
    label: 'remove a member',
    effect: ['User', 'AuditLog'],
    allowed: members,
    args: () => [FIXTURES.accounts.leaver.id],
  },
  {
    action: 'members.removeMember',
    label: 'remove an owner (never)',
    allowed: nobody,
    args: () => ['qa-persona-owner'],
  },
  {
    action: 'members.changeMemberRole',
    label: 'give a member a role the actor holds',
    effect: ['User', 'AuditLog'],
    allowed: members,
    args: () => [FIXTURES.accounts.leaver.id, FIXTURES.spareRole],
  },
  {
    action: 'members.changeMemberRole',
    label: 'give a member the Admin role',
    effect: ['User', 'AuditLog'],
    allowed: (who) => who === 'admin' || who === 'owner',
    args: () => [FIXTURES.accounts.leaver.id, 'role-admin'],
  },
  // ---- the roles ----
  {
    action: 'roles.createRole',
    label: 'create a role',
    effect: ['Role', 'AuditLog'],
    allowed: roles,
    args: () => [{}, roleForm('QA New Role')],
  },
  {
    action: 'roles.updateRole',
    label: 'edit a role nobody holds',
    effect: ['Role', 'AuditLog'],
    allowed: roles,
    args: () => [FIXTURES.spareRole, {}, roleForm('QA Spare Renamed')],
  },
  {
    action: 'roles.deleteRole',
    label: 'delete a role nobody holds',
    effect: ['Role', 'AuditLog'],
    allowed: roles,
    args: () => [FIXTURES.spareRole],
  },
  {
    action: 'roles.deleteRole',
    label: 'delete the default role (never)',
    allowed: nobody,
    args: () => ['role-member'],
  },
  {
    action: 'roles.setDefaultRole',
    label: 'make a role the default',
    effect: ['Role', 'AuditLog'],
    allowed: roles,
    args: () => ['role-qa-treasurer'],
  },
  // ---- the events ----
  {
    action: 'events.createEvent',
    label: 'create a draft',
    effect: ['Event', 'AuditLog'],
    allowed: mayPropose,
    args: () => [{}, eventForm()],
  },
  {
    action: 'events.createEvent',
    label: 'create a published event',
    effect: ['Event', 'AuditLog'],
    // Publishing is for those who validate: a proposer asking for it by crafting the request is refused.
    allowed: validates,
    args: () => [{}, eventForm({ status: 'CONFIRMED' })],
  },
  {
    action: 'events.updateEvent',
    label: 'edit a published event',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.confirmed, {}, eventForm({ status: 'CONFIRMED', title: 'Edited' })],
  },
  {
    action: 'events.updateEvent',
    label: 'edit the draft of somebody else',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.draft, {}, eventForm({ title: 'Edited' })],
  },
  {
    action: 'events.updateEvent',
    label: 'edit one’s own draft',
    effect: ['Event', 'AuditLog'],
    // The author who only proposes may edit what is not published yet, and only their own.
    allowed: (who, variant) =>
      validates(who, variant) || (who === 'proposer' && can(who, 'events.propose', variant)),
    args: () => [events.ownDraft, {}, eventForm({ title: 'Edited' })],
  },
  {
    action: 'events.updateEvent',
    label: 'edit one’s own published event',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.ownConfirmed, {}, eventForm({ status: 'CONFIRMED', title: 'Edited' })],
  },
  {
    action: 'events.deleteEvent',
    label: 'delete a published event',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.confirmed],
  },
  {
    action: 'events.deleteEvent',
    label: 'delete one’s own draft',
    effect: ['Event', 'AuditLog'],
    allowed: (who, variant) =>
      validates(who, variant) || (who === 'proposer' && can(who, 'events.propose', variant)),
    args: () => [events.ownDraft],
  },
  {
    action: 'events.setEventStatus',
    label: 'publish a draft',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.draft, 'CONFIRMED'],
  },
  {
    action: 'events.setEventStatus',
    label: 'approve a proposal',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.proposed, 'CONFIRMED'],
  },
  {
    action: 'events.setEventStatus',
    label: 'propose one’s own draft',
    effect: ['Event', 'AuditLog'],
    // Proposing is what somebody who cannot publish does: those who validate publish instead.
    allowed: (who, variant) => who === 'proposer' && can(who, 'events.propose', variant),
    args: () => [events.ownDraft, 'PROPOSED'],
  },
  {
    action: 'events.setEventStatus',
    label: 'withdraw one’s own proposal',
    effect: ['Event', 'AuditLog'],
    allowed: (who, variant) => who === 'proposer' && can(who, 'events.propose', variant),
    args: () => [events.ownProposed, 'DRAFT'],
  },
  {
    action: 'events.refuseEvent',
    label: 'refuse a proposal, with the reason',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: () => [events.proposed, 'This date falls during the exams.'],
  },
  {
    action: 'events.cancelOccurrence',
    label: 'cancel one date of a series',
    effect: ['EventCancellation', 'AuditLog'],
    allowed: validates,
    args: (context) => [events.series, context.seriesStart + WEEK],
  },
  {
    action: 'events.restoreOccurrence',
    label: 'restore a cancelled date',
    effect: ['EventCancellation', 'AuditLog'],
    allowed: validates,
    args: (context) => [events.series, context.seriesStart + WEEK],
    prepare: async (db, context) => {
      await db.query(
        `INSERT INTO "EventCancellation" ("id", "eventId", "occurrenceStart", "cancelledByLogin") VALUES ('qa-cancel-prepared', $1, $2::timestamp, 'qa-validator') ON CONFLICT DO NOTHING`,
        [events.series, new Date(context.seriesStart + WEEK).toISOString()],
      );
    },
  },
  {
    action: 'events.deleteFollowingDates',
    label: 'delete a date of a series and the following',
    effect: ['Event', 'AuditLog'],
    allowed: validates,
    args: (context) => [events.series, context.seriesStart + 2 * WEEK],
  },
  {
    action: 'events.refuseEvent',
    label: 'refuse an event that is not a proposal',
    allowed: nobody,
    args: () => [events.confirmed, 'No.'],
  },
  // ---- the calendar links ----
  {
    action: 'shared-calendar.enableSharedCalendar',
    label: 'turn the BDE link on',
    effect: ['BdeCalendarFeed', 'AuditLog'],
    allowed: sharesCalendar,
    args: () => [],
  },
  {
    action: 'shared-calendar.regenerateSharedCalendar',
    label: 'regenerate the BDE link',
    effect: ['BdeCalendarFeed', 'AuditLog'],
    allowed: sharesCalendar,
    args: () => [],
    prepare: async (db) => {
      await db.query(
        `INSERT INTO "BdeCalendarFeed" ("id", "token", "updatedAt") VALUES ('bde', $1, now()) ON CONFLICT ("id") DO UPDATE SET "token" = EXCLUDED."token"`,
        ['T'.repeat(43)],
      );
    },
  },
  {
    action: 'shared-calendar.disableSharedCalendar',
    label: 'turn the BDE link off',
    effect: ['BdeCalendarFeed', 'AuditLog'],
    allowed: sharesCalendar,
    args: () => [],
    prepare: async (db) => {
      await db.query(
        `INSERT INTO "BdeCalendarFeed" ("id", "token", "updatedAt") VALUES ('bde', $1, now()) ON CONFLICT ("id") DO UPDATE SET "token" = EXCLUDED."token"`,
        ['T'.repeat(43)],
      );
    },
  },
  {
    action: 'profile.regenerateMyCalendarToken',
    label: 'regenerate one’s own feed link',
    effect: ['User'],
    // Everybody who can read the events has a link to the calendar.
    allowed: (who, variant) => can(who, 'events.view', variant),
    args: () => [],
  },
  // ---- the templates of the notifications: whoever holds the right to customise them ----
  ...TEMPLATE_CASES,
  // ---- the settings: the owner's ----
  ...OWNER_ONLY_SETTINGS.map(([name, args]): ActionCase => ({
    action: `settings.${name}`,
    label: `settings: ${name}`,
    allowed: (who) => isOwner(who),
    args: () => [...args],
    strictThrow: true,
    control: 'answers',
  })),
  // ---- the installer: over for everybody once the platform is installed ----
  ...INSTALLER.map((name): ActionCase => ({
    action: `setup.${name}`,
    label: `installer: ${name}`,
    allowed: nobody,
    args: () => [{}],
    strictThrow: true,
  })),
  // ---- development tools: never in production, not even for an owner ----
  {
    action: 'dev-impersonation.startImpersonation',
    label: 'become another role',
    allowed: nobody,
    args: () => ['MEMBER'],
    strictThrow: true,
  },
  {
    action: 'dev-impersonation.stopImpersonation',
    label: 'stop being another role',
    allowed: nobody,
    args: () => [],
    strictThrow: true,
  },
];
