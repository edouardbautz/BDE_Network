import type { ActionCase, Context } from '../access/actions';
import { discoverActionFields } from '../access/discover';
import { inputLeaves, missingFieldLeaves, type Leaf } from './sql-targets';
import { NOTIFICATION_EVENTS } from '../../src/config/schema';

/**
 * What the `sql` suite starts from for the actions whose case in the access matrix does not hold the text a page would send: those cases test the
 * gate (`{}` is enough for that: the gate is the first thing an action does), so a string cannot be replaced in them. These are the arguments as the
 * page sends them (the shape each action reads), with plausible, harmless values: one of them is replaced at a time by what an injection sends.
 *
 * The settings are the owner's and the installer's are closed once the platform is installed: the attack goes through the same door a crafted request
 * would, and what matters is what comes out of it. The platform the suite runs on is a throwaway one, like the scan's (a name saved in the settings stays).
 */

const identity = {
  name: 'BDE QA',
  accentColor: '#2F5BEA',
  messageLocale: 'fr',
  contactEmail: 'bureau@example.org',
};
const credentials = { clientId: 'qa-client', clientSecret: 'qa-secret' };
const campuses = { campuses: ['Paris'], mainCampus: 'Paris', timezone: 'Europe/Paris' };
const channels = Object.fromEntries(NOTIFICATION_EVENTS.map((event) => [event, [] as string[]]));
const notifications = { matrix: channels, discordWebhook: '', slackWebhook: '' };
const test = { locale: 'fr', channel: 'discord', to: '' };

export const TEXT_ARGUMENTS: Record<string, () => unknown[]> = {
  'settings.saveIdentity': () => [identity],
  'settings.saveEvents': () => [
    {
      categories: [{ key: 'soiree', label: 'Soirée', color: '#7c3aed' }],
      reminderHour: 18,
      intraPublication: false,
      reassign: { autre: 'soiree' },
    },
  ],
  'settings.saveStaffChannel': () => [{ discordWebhook: '', slackWebhook: '' }],
  'settings.testStaffChannel': () => [{ locale: 'fr', channel: 'discord', webhook: '' }],
  'settings.saveAddress': () => [{ address: 'http://localhost:3100', acceptInsecure: true }],
  'settings.verifyFortyTwo': () => [credentials],
  'settings.skipFortyTwoVerification': () => [credentials],
  'settings.saveCampuses': () => [campuses],
  'settings.addOwner': () => [{ login: 'qa-nobody', acceptUnverified: false }],
  'settings.removeOwner': () => [{ login: 'qa-nobody' }],
  'settings.saveModules': () => [{ events: true }],
  'settings.saveUpdates': () => [{ check: false }],
  'settings.saveNotifications': () => [notifications],
  'settings.testNotification': () => [notifications, test],
  'setup.submitCode': () => ['K7QM-4XPD'],
  'setup.saveIdentity': () => [identity],
  'setup.saveAddress': () => [{ address: 'http://localhost:3100', acceptInsecure: true }],
  'setup.verifyFortyTwo': () => [credentials],
  'setup.skipFortyTwoVerification': () => [credentials],
  'setup.saveCampuses': () => [campuses],
  'setup.checkOwner': () => [{ login: 'qa-nobody' }],
  'setup.saveOwners': () => [{ owners: ['qa-nobody'] }],
  'setup.saveModules': () => [{ events: true }],
  'setup.saveNotifications': () => [notifications],
  'setup.testNotification': () => [notifications, test],
  // The login of the member who has just been removed (the page adds it to the address): a string a request can send anything in.
  'shared-calendar.regenerateSharedCalendar': () => ['qa-leaver'],
};

/**
 * Actions that have a parameter and still take no text a request could change, and why. A reason is a fact of the code, not a wish: each is checked by
 * `sql-coverage.test.ts` against the cases (an action in here that does hold a string is stale). None today: even the logo, a file, is read from a field that a
 * request can fill with a string.
 */
export const NO_TEXT: Record<string, string> = {};

/** The fields each file of actions reads from a form, found in the source once. */
const FIELDS_READ = discoverActionFields();

/** What the suite starts from for a case: the arguments of the settings and of the installer as a page sends them, else the matrix's own. */
export function argumentsToAttack(item: ActionCase, context: Context): unknown[] {
  return TEXT_ARGUMENTS[item.action]?.() ?? item.args(context);
}

/**
 * Everything a crafted request can put text in, for a case: every scalar of its arguments, and every field of a form that the action reads and the form of the
 * case does not hold (`scope`, `occurrence`, `assignees`: the page sends them, the matrix has no reason to). Which fields an action reads is found in its source.
 */
export function attackSurface(
  item: ActionCase,
  context: Context,
): { args: unknown[]; leaves: Leaf[] } {
  const args = argumentsToAttack(item, context);
  return {
    args,
    leaves: [...inputLeaves(args), ...missingFieldLeaves(args, FIELDS_READ[item.action] ?? [])],
  };
}
