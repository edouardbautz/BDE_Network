import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The list of notifications of the editor's page never scrolls sideways (docs/design.md, "Lists of choices"). It used to be a row of
 * links in a box with `overflow-x: auto` below 1024 px: the section "Events" had a scroll bar and cut "Proposal refused". Now, under
 * 640 px each section is a list, one notification a line, whole; from 640 px the notifications wrap onto several lines; from 1024 px
 * they are a column beside the editor. Measured in the three engines, in both themes: no box of the list scrolls, no link sticks out of
 * the list, on a phone each link is a line of 44 px at least, and the sections have a heading of their own.
 */

const SCREENS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  computer: { width: 1280, height: 800 },
} as const;

for (const [screen, viewport] of Object.entries(SCREENS)) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the list of notifications is whole on a ${screen}, ${colorScheme}`, async ({ as }) => {
      const page = await as('owner', { viewport, colorScheme });
      await page.goto('/en/notifications?type=eventConfirmed');
      await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
      await atRest(page);

      const list = page.getByRole('navigation', { name: 'Notifications to customise' });
      const links = list.getByRole('link');
      expect(await links.count()).toBeGreaterThan(5);

      const facts = await list.evaluate((nav) => {
        const frame = nav.getBoundingClientRect();
        const scrolling = [nav, ...nav.querySelectorAll('*')].filter(
          (element) =>
            element.scrollWidth > element.clientWidth + 1 &&
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowX),
        ).length;
        const outside = [...nav.querySelectorAll('a')].filter((link) => {
          const box = link.getBoundingClientRect();
          return box.left < frame.left - 1 || box.right > frame.right + 1;
        }).length;
        const clipped = [...nav.querySelectorAll('a, a *')].filter(
          (element) => element.scrollWidth > element.clientWidth + 1,
        ).length;
        const lines = [...nav.querySelectorAll('a')].map((link) => {
          const box = link.getBoundingClientRect();
          return { top: Math.round(box.top), height: box.height, width: box.width };
        });
        return { scrolling, outside, clipped, lines, frame: frame.width };
      });
      expect(facts.scrolling, 'a box of the list scrolls').toBe(0);
      expect(facts.outside, 'a link sticks out of the list').toBe(0);
      expect(facts.clipped, 'a text of the list is cut').toBe(0);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);

      for (const line of facts.lines) expect(line.height).toBeGreaterThanOrEqual(44);
      if (screen === 'phone') {
        // one notification a line, as wide as the list
        expect(new Set(facts.lines.map((line) => line.top)).size).toBe(facts.lines.length);
        for (const line of facts.lines) expect(line.width).toBeGreaterThan(facts.frame - 2);
      }

      // the sections are told apart: a heading each, bigger than the small captions of the page
      const headings = list.getByRole('heading', { level: 2 });
      expect(await headings.count()).toBeGreaterThanOrEqual(2);
      await expect(headings.first()).toBeVisible();
      await expect(list.getByRole('link', { name: /Proposal refused/ })).toBeVisible();
      await expect(list.getByRole('link', { name: /Event confirmed/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }
}
