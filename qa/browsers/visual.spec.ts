import { FIXTURES } from '../dataset';
import type { PersonaKey } from '../personas';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * What the pages look like, compared with a reference picture of each (phase 6; "Visual regression" in docs/architecture.md).
 * A change of look that nobody meant (a token, a class, a library that draws a control another way) shows as a picture that
 * differs, with the difference drawn; a change that was meant is accepted by making the references again, which is a commit of
 * pictures on a branch of their own, read by a person.
 *
 * Chromium only, on the platform made by \`sh qa/platform.sh up --now 2026-10-16T12:00:00Z\`: the clock of the application is
 * the moment of the dataset, so the dates to come and the day marked as today do not move from one day to the next. The
 * references are made where they are compared, by the workflow, because the same page is not drawn pixel for pixel the same by
 * two systems (the fonts, the anti-aliasing): a reference made on another computer would differ everywhere.
 */

/** The moment of the platform (`--now`), which is also the one the dataset is built around. */
export const MOMENT = '2026-10-16T12:00:00Z';

const SCREENS = {
  computer: { width: 1280, height: 800 },
  phone: { width: 390, height: 800 },
} as const;

interface Shot {
  /** The name of the picture. */
  name: string;
  who: PersonaKey;
  path: string;
  /** The whole page, or what the screen shows (a page of 300 rows is not a picture). */
  full?: boolean;
  /** Also in French (the other language of the interface), on a computer, in the light theme. */
  french?: boolean;
}

const EVENT = FIXTURES.events;
const SHOTS: Shot[] = [
  { name: 'login', who: 'anonymous', path: '/en', french: true },
  { name: 'privacy', who: 'anonymous', path: '/en/privacy', full: true },
  { name: 'pending', who: 'pending', path: '/en/pending' },
  { name: 'not-found', who: 'anonymous', path: '/en/does/not/exist' },
  { name: 'dashboard', who: 'member', path: '/en/dashboard', full: true },
  {
    name: 'calendar',
    who: 'member',
    path: '/en/events?view=calendar&month=2026-10',
    full: true,
    french: true,
  },
  { name: 'event-list', who: 'member', path: '/en/events?view=list' },
  { name: 'event', who: 'member', path: `/en/events/${EVENT.confirmed}`, full: true, french: true },
  { name: 'event-series', who: 'owner', path: `/en/events/${EVENT.series}`, full: true },
  { name: 'event-draft', who: 'validator', path: `/en/events/${EVENT.draft}`, full: true },
  { name: 'event-proposed', who: 'validator', path: `/en/events/${EVENT.proposed}`, full: true },
  {
    name: 'event-form',
    who: 'proposer',
    path: '/en/events/new?date=2026-10-20',
    full: true,
    french: true,
  },
  { name: 'review', who: 'validator', path: '/en/events/review' },
  { name: 'members', who: 'owner', path: '/en/members' },
  { name: 'roles', who: 'owner', path: '/en/roles', full: true },
  { name: 'role-form', who: 'owner', path: '/en/roles/new', full: true },
  { name: 'audit-log', who: 'owner', path: '/en/audit-log' },
  { name: 'settings', who: 'owner', path: '/en/settings' },
  { name: 'profile', who: 'member', path: '/en/profile', full: true },
];

const THEMES = ['light', 'dark'] as const;

test.describe('visual references', () => {
  for (const shot of SHOTS) {
    for (const [screenName, viewport] of Object.entries(SCREENS)) {
      for (const colorScheme of THEMES) {
        test(`${shot.name}: ${screenName}, ${colorScheme}`, async ({ as }) => {
          const page = await as(shot.who, { viewport, colorScheme });
          await page.goto(shot.path);
          await expect(page.locator('main')).toBeVisible();
          await atRest(page);
          await expect(page).toHaveScreenshot(`${shot.name}-${screenName}-${colorScheme}.png`, {
            fullPage: shot.full ?? false,
          });
        });
      }
    }

    if (shot.french) {
      test(`${shot.name}: French, computer, light`, async ({ as }) => {
        const page = await as(shot.who, { viewport: SCREENS.computer, colorScheme: 'light' });
        await page.goto(shot.path.replace(/^\/en/, '/fr'));
        await expect(page.locator('main')).toBeVisible();
        await atRest(page);
        await expect(page).toHaveScreenshot(`${shot.name}-computer-light-fr.png`, {
          fullPage: shot.full ?? false,
        });
      });
    }
  }
});
