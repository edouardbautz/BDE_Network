import { FIXTURES } from '../dataset';
import type { PersonaKey, PlatformVariant } from '../personas';
import { LOCALE, can, isApproved, isOwner } from './model';

/**
 * Who may open what: every page and API route of the platform, for each persona, on a platform run with the events
 * module on and off. It is the expectation; `run.ts` plays it against the real image, and `coverage.test.ts` fails
 * when a page or a route of the source is missing from it (or the matrix names one that is gone).
 *
 * "denied" is any answer that does not show the content (the page is not found, or the visitor is sent elsewhere).
 * Where the platform's rule is more precise (a visitor is sent to the login page, somebody who waits for approval to
 * the waiting page) the expectation says so.
 */

export type Expect =
  | { kind: 'ok' }
  | { kind: 'denied' }
  | { kind: 'redirect'; to: string }
  | { kind: 'notFound' }
  | { kind: 'status'; codes: readonly number[] };

export interface Probe {
  /** What this request is, in a few words. */
  label: string;
  /** The path to open (with the query), from the root of the site. */
  path: string;
  /** What each persona must get. `cookie` is whose session cookie is sent, for the routes that take a token instead. */
  expect(who: PersonaKey, variant: PlatformVariant): Expect;
  /** Only run it for these variants (default: both). */
  variants?: readonly PlatformVariant[];
}

export interface RouteSpec {
  /** The route as `discover.ts` names it. */
  route: string;
  probes: readonly Probe[];
}

const ok: Expect = { kind: 'ok' };
const denied: Expect = { kind: 'denied' };
const notFound: Expect = { kind: 'notFound' };
const redirect = (to: string): Expect => ({ kind: 'redirect', to });
const status = (...codes: number[]): Expect => ({ kind: 'status', codes });

const at = (path: string) => `/${LOCALE}${path}`;

/** What the layout of the application does before any page: a visitor (or a removed member) signs in, a pending account waits. */
function entrance(who: PersonaKey): Expect | null {
  if (who === 'anonymous' || who === 'deleted') return redirect(at(''));
  if (who === 'pending') return redirect(at('/pending'));
  return null;
}

/** A page of the application: the entrance first, then the rule of the page. */
const inApp = (who: PersonaKey, rule: () => Expect): Expect => entrance(who) ?? rule();

const eventsOff = (variant: PlatformVariant) => variant === 'events-disabled';

type Kind = keyof typeof FIXTURES.events;
const EVENT_KINDS: readonly Kind[] = ['confirmed', 'draft', 'proposed', 'ownDraft', 'ownProposed', 'ownConfirmed', 'series'];

const isPublished = (kind: Kind) => kind === 'confirmed' || kind === 'ownConfirmed' || kind === 'series';
const isOwnByProposer = (kind: Kind) => kind === 'ownDraft' || kind === 'ownProposed' || kind === 'ownConfirmed';

/** Whether this persona sees the event at all (a draft or a proposal is for those who validate, and for its own author). */
function seesEvent(who: PersonaKey, kind: Kind): boolean {
  if (isPublished(kind)) return true;
  if (can(who, 'events.validate')) return true;
  return who === 'proposer' && isOwnByProposer(kind);
}

/** Whether this persona may edit it: those who validate anything, a proposer their own events that are not published. */
function mayEditEvent(who: PersonaKey, kind: Kind): boolean {
  if (can(who, 'events.validate')) return true;
  return who === 'proposer' && (kind === 'ownDraft' || kind === 'ownProposed');
}

const eventProbes = (suffix: string, rule: (who: PersonaKey, kind: Kind | 'missing', variant: PlatformVariant) => Expect, prefix = ''): Probe[] =>
  [...EVENT_KINDS, 'missing' as const].map((kind) => ({
    label: `event: ${kind}`,
    path: `${prefix}${at(`/events/${kind === 'missing' ? 'qa-fx-missing' : FIXTURES.events[kind]}${suffix}`)}`,
    expect: (who, variant) => rule(who, kind, variant),
  }));

export const PAGES: readonly RouteSpec[] = [
  {
    route: '/',
    probes: [
      {
        label: 'the login page',
        path: at(''),
        // Somebody signed in is sent on: the waiting page, or the dashboard.
        expect: (who) =>
          who === 'anonymous' || who === 'deleted' ? ok : who === 'pending' ? redirect(at('/pending')) : redirect(at('/dashboard')),
      },
    ],
  },
  { route: '/privacy', probes: [{ label: 'the privacy policy', path: at('/privacy'), expect: () => ok }] },
  { route: '/auth-error', probes: [{ label: 'the sign-in refused page', path: at('/auth-error'), expect: () => ok }] },
  { route: '/unavailable', probes: [{ label: 'the database is down page', path: at('/unavailable'), expect: () => ok }] },
  {
    route: '/pending',
    probes: [
      {
        label: 'the waiting page',
        path: at('/pending'),
        expect: (who) =>
          who === 'pending' ? ok : who === 'anonymous' || who === 'deleted' ? redirect(at('')) : redirect(at('/dashboard')),
      },
    ],
  },
  {
    route: '/setup',
    // The installer exists for a platform with nothing decided; once installed it is a 404 for good, for everybody.
    probes: [{ label: 'the installer, once installed', path: at('/setup'), expect: () => notFound }],
  },
  {
    route: '/[...rest]',
    probes: [
      { label: 'an address that does not exist', path: at('/this/does/not/exist'), expect: () => notFound },
      // A path that tries to climb out of the site is just another address that does not exist.
      { label: 'a path that climbs', path: at('/..%2f..%2fetc%2fpasswd'), expect: () => notFound },
    ],
  },
  { route: '/dashboard', probes: [{ label: 'the dashboard', path: at('/dashboard'), expect: (who) => inApp(who, () => ok) }] },
  { route: '/profile', probes: [{ label: 'the profile', path: at('/profile'), expect: (who) => inApp(who, () => ok) }] },
  {
    route: '/events',
    probes: [
      {
        label: 'the calendar',
        path: at('/events'),
        expect: (who, variant) => inApp(who, () => (eventsOff(variant) ? notFound : ok)),
      },
      {
        label: 'the list',
        path: at('/events?view=list'),
        expect: (who, variant) => inApp(who, () => (eventsOff(variant) ? notFound : ok)),
      },
    ],
  },
  {
    route: '/events/new',
    probes: [
      {
        label: 'the form of a new event',
        path: at('/events/new'),
        expect: (who, variant) =>
          inApp(who, () =>
            eventsOff(variant)
              ? notFound
              : can(who, 'events.propose') || can(who, 'events.validate')
                ? ok
                : redirect(at('/events')),
          ),
      },
    ],
  },
  {
    route: '/events/review',
    probes: [
      {
        label: 'the proposals to validate',
        path: at('/events/review'),
        expect: (who, variant) => inApp(who, () => (can(who, 'events.validate', variant) ? ok : denied)),
      },
    ],
  },
  {
    route: '/events/shared-calendar',
    probes: [
      {
        label: 'the link of the BDE calendar',
        path: at('/events/shared-calendar'),
        expect: (who, variant) => inApp(who, () => (can(who, 'events.shared_calendar', variant) ? ok : denied)),
      },
    ],
  },
  {
    route: '/events/[id]',
    probes: eventProbes('', (who, kind, variant) =>
      inApp(who, () =>
        eventsOff(variant) || kind === 'missing' || !seesEvent(who, kind) ? notFound : ok,
      ),
    ),
  },
  {
    route: '/events/[id]/edit',
    probes: eventProbes('/edit', (who, kind, variant) =>
      inApp(who, () => {
        if (eventsOff(variant)) return notFound;
        // Somebody who cannot write events is sent back to the event, whatever it is (before anything is looked up).
        if (!can(who, 'events.propose') && !can(who, 'events.validate')) return redirect(at(`/events/${kind === 'missing' ? 'qa-fx-missing' : FIXTURES.events[kind]}`));
        if (kind === 'missing' || !seesEvent(who, kind)) return notFound;
        return mayEditEvent(who, kind) ? ok : redirect(at(`/events/${FIXTURES.events[kind]}`));
      }),
    ),
  },
  { route: '/members', probes: [{ label: 'the members', path: at('/members'), expect: (who) => inApp(who, () => (can(who, 'members.manage') ? ok : denied)) }] },
  { route: '/roles', probes: [{ label: 'the roles', path: at('/roles'), expect: (who) => inApp(who, () => (can(who, 'roles.manage') ? ok : denied)) }] },
  { route: '/roles/new', probes: [{ label: 'a new role', path: at('/roles/new'), expect: (who) => inApp(who, () => (can(who, 'roles.manage') ? ok : denied)) }] },
  {
    route: '/roles/[id]',
    probes: [
      { label: 'the default role', path: at('/roles/role-member'), expect: (who) => inApp(who, () => (can(who, 'roles.manage') ? ok : denied)) },
      { label: 'a role that does not exist', path: at('/roles/role-qa-missing'), expect: (who) => inApp(who, () => (can(who, 'roles.manage') ? notFound : denied)) },
    ],
  },
  { route: '/audit-log', probes: [{ label: 'the audit log', path: at('/audit-log'), expect: (who) => inApp(who, () => (isOwner(who) ? ok : denied)) }] },
  { route: '/settings', probes: [{ label: 'the settings', path: at('/settings'), expect: (who) => inApp(who, () => (isOwner(who) ? ok : denied)) }] },
];

/** The persona's feed token is read from the database by the run; this marks which probe uses whose. */
export const FEED_OF = (who: PersonaKey) => `feed-of:${who}`;

const csv = (variant: PlatformVariant) => (eventsOff(variant) ? status(404) : status(200));

export const API: readonly RouteSpec[] = [
  { route: '/api/health', probes: [{ label: 'liveness and database', path: '/api/health', expect: () => status(200) }] },
  {
    route: '/api/logo',
    probes: [
      { label: 'no logo has been uploaded', path: '/api/logo?v=0000000000000000', expect: () => status(404) },
      { label: 'a version that is not one', path: '/api/logo?v=../../etc/passwd', expect: () => status(404) },
      { label: 'no version', path: '/api/logo', expect: () => status(404) },
    ],
  },
  {
    route: '/api/auth/[...nextauth]',
    probes: [
      { label: 'the session of the visitor', path: '/api/auth/session', expect: () => status(200) },
      { label: 'the providers', path: '/api/auth/providers', expect: () => status(200) },
      { label: 'the CSRF token', path: '/api/auth/csrf', expect: () => status(200) },
    ],
  },
  {
    route: '/api/me/export',
    probes: [
      {
        label: 'one’s own data',
        path: '/api/me/export',
        // Who has an account can take their data away: a visitor or a removed member has none.
        expect: (who) => (isApproved(who) || who === 'pending' ? status(200) : status(401)),
      },
    ],
  },
  {
    route: '/api/updates',
    probes: [
      {
        label: 'the notice of a new version',
        path: '/api/updates',
        // Owners only, and a bare 404 for everybody else: the route must not even say that it exists.
        expect: (who) => (isOwner(who) ? status(200) : status(404)),
      },
    ],
  },
  {
    route: '/api/events/[id]/ics',
    probes: [
      ...EVENT_KINDS.map(
        (kind): Probe => ({
          label: `add to my calendar: ${kind}`,
          path: `/api/events/${FIXTURES.events[kind]}/ics`,
          expect: (who, variant) =>
            isApproved(who) && !eventsOff(variant) && seesEvent(who, kind) ? status(200) : status(404, 401),
        }),
      ),
      {
        label: 'add to my calendar: an event that does not exist',
        path: '/api/events/qa-fx-missing/ics',
        expect: () => status(404, 401),
      },
    ],
  },
  {
    route: '/api/calendar/[token]',
    probes: [
      ...(['member', 'proposer', 'validator', 'custom', 'admin', 'owner'] as const).map(
        (owner): Probe => ({
          label: `the subscription feed of the ${owner}`,
          path: `/api/calendar/${FEED_OF(owner)}`,
          // The link is the credential: no cookie is needed (or looked at); a module that is off has no feed.
          expect: (who, variant) => (who === 'anonymous' ? csv(variant) : csv(variant)),
        }),
      ),
      { label: 'a token nobody has', path: `/api/calendar/${'A'.repeat(43)}`, expect: () => status(404) },
      { label: 'a token of the wrong shape', path: '/api/calendar/short', expect: () => status(404) },
      { label: 'a token that tries an injection', path: `/api/calendar/${encodeURIComponent("' OR '1'='1")}`, expect: () => status(404) },
    ],
  },
  {
    route: '/api/calendar/bde/[token]',
    probes: [
      // The shared link is off on a fresh platform: whatever the token, there is nothing behind it.
      { label: 'a token while the shared link is off', path: `/api/calendar/bde/${'B'.repeat(43)}`, expect: () => status(404) },
      { label: 'a token of the wrong shape', path: '/api/calendar/bde/short', expect: () => status(404) },
    ],
  },
];
