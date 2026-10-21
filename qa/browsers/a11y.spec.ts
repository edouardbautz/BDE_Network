import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { PAGES } from '../access/matrix';
import { LOCALE } from '../access/model';
import { PERSONAS, type PersonaKey } from '../personas';
import { expect, test } from './fixtures';

/**
 * Accessibility of every page of the platform, checked by axe against WCAG 2.2 level AA, in the way a person would meet
 * it: signed in as somebody who sees the page, in both languages, both themes, on a computer and on a phone.
 *
 * The pages are the ones of the access matrix (`qa/access/matrix.ts`): a page added there is checked here with nothing to
 * write, and the matrix itself fails until a new page is in it. Two viewers of each page: the first persona who sees it
 * (what everybody sees) and the one with the most rights (what the page shows to somebody who can do more: the buttons that
 * only some are offered). axe finds a part of what is wrong (colour contrast, names, roles, labels, landmarks, the order of
 * headings…); `keyboard.spec.ts` plays what it cannot.
 *
 * A violation is a failure with the elements it names. There is no list of accepted ones: a page that cannot pass is a defect to
 * fix, and an exception would have to be written here with its reason, next to the page.
 */

/** Chromium only (see `playwright.config.ts`): what axe reports is the page's, not the engine's. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** From the least to the most rights, as the personas are written. */
const ORDER: readonly PersonaKey[] = [
  'anonymous',
  'pending',
  'member',
  'proposer',
  'validator',
  'custom',
  'admin',
  'owner',
];

const COMBINATIONS = [
  {
    name: 'English, light, computer',
    locale: 'en',
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
  },
  {
    name: 'French, dark, phone',
    locale: 'fr',
    colorScheme: 'dark',
    viewport: { width: 390, height: 800 },
  },
] as const;

/** Who sees `probe` (the matrix says so, for the platform with the events module on). */
function viewersOf(probe: {
  expect(who: PersonaKey, variant: 'events-enabled'): { kind: string };
}) {
  const seeing = ORDER.filter(
    (who) =>
      PERSONAS.some((persona) => persona.key === who) &&
      probe.expect(who, 'events-enabled').kind === 'ok',
  );
  if (seeing.length === 0) return [];
  return [...new Set([seeing[0], seeing[seeing.length - 1]])] as PersonaKey[];
}

const probes = PAGES.flatMap((page) => page.probes);

/**
 * The page at rest. axe judges the colours as they are drawn at the instant it looks, and a control that fades (the Save
 * button of the campuses is disabled while the list loads, and fades in when it arrives) is drawn half-way for a moment: in CI,
 * slower than a developer's computer, axe caught it at 72 % (white on 3.2:1). So the page is left alone until what it asks of
 * the platform has come back and what it animates has finished (an animation that never ends, a spinner, is what it is).
 */
async function atRest(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState === 'finished' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const probe of probes) {
    for (const who of viewersOf(probe)) {
      for (const combination of COMBINATIONS) {
        test(`${probe.label} (${probe.path.slice(LOCALE.length + 1)}), as ${who}: ${combination.name}`, async ({
          as,
        }) => {
          const page = await as(who, {
            viewport: combination.viewport,
            colorScheme: combination.colorScheme,
          });
          // The matrix writes its addresses in its own language: the page is opened in the one of the combination.
          const path = `/${combination.locale}${probe.path.slice(LOCALE.length + 1)}`;
          await page.goto(path);
          // What is checked is the page, not the loading skeleton that stands in for it.
          await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
          await expect(page.locator('main')).toBeVisible();
          await atRest(page);
          await expect(page.locator('html')).toHaveAttribute('lang', combination.locale);
          await expect(page.locator('html')).toHaveClass(
            combination.colorScheme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
          );

          // Every page has a title of its own (WCAG 2.4.2): at least what the page is, then the BDE.
          const title = await page.title();
          if (!/\b(pending|auth-error)\b/.test(probe.path)) expect(title).toMatch(/ · /);

          const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
          expect(
            violations.map(
              (violation) =>
                `${violation.id} (${violation.impact}): ${violation.help}\n` +
                violation.nodes
                  .slice(0, 4)
                  .map(
                    (node) =>
                      `    ${node.target.join(' ')}\n      ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`,
                  )
                  .join('\n'),
            ),
            `${path} as ${who}`,
          ).toEqual([]);
        });
      }
    }
  }

  // A check that cannot fail proves nothing: the page is given what axe is for (a control with no name, text that cannot be
  // read, an image with no alternative), and axe must say so, with the tags and the settings the pages are checked with.
  test('sees what it is for: a control with no name, pale text, an image with no alternative', async ({
    as,
  }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');
    await expect(page.locator('main')).toBeVisible();
    await page.evaluate(() => {
      document
        .querySelector('main')
        ?.insertAdjacentHTML(
          'beforeend',
          '<button></button><p style="color:#bbb;background:#fff">pale text</p><img src="/logo.svg">',
        );
    });
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(violations.map((violation) => violation.id)).toEqual(
      expect.arrayContaining(['button-name', 'color-contrast', 'image-alt']),
    );
  });
});
