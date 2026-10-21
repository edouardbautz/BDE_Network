import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * What a page asks the platform for, counted in a real browser (Chromium only, see `playwright.config.ts`). The load test
 * (`qa/perf/load.ts`, k6) cannot see what a browser does of its own accord, and one thing it does is prefetch the pages that
 * the links in view lead to, each of which is a rendering by the server. The calendar made 110 of those for a month of a hundred
 * events (found by Lighthouse, fixed by not prefetching the events of the calendar); this holds it.
 */

/** The requests a browser makes to load the page of its own accord (Next.js marks a prefetch with a header). */
async function prefetchesOf(
  page: import('@playwright/test').Page,
  path: string,
): Promise<string[]> {
  const prefetches: string[] = [];
  page.on('request', (request) => {
    if (request.headers()['next-router-prefetch'] === '1') prefetches.push(request.url());
  });
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  await atRest(page);
  return prefetches;
}

test.describe('what a page asks of the platform', () => {
  test('the calendar of a busy month, on a computer, prefetches next to nothing', async ({
    as,
  }) => {
    const page = await as('member', { viewport: { width: 1280, height: 900 } });
    const prefetches = await prefetchesOf(page, '/en/events?view=calendar&month=2026-10');
    // The links of the menu, and the other view: a handful. Not the page of each of the hundred events of the month.
    expect(prefetches.length, prefetches.join('\n')).toBeLessThanOrEqual(15);
  });

  test('the list and the dashboard prefetch what they link to, and no more than a screen holds', async ({
    as,
  }) => {
    const page = await as('member', { viewport: { width: 1280, height: 900 } });
    expect((await prefetchesOf(page, '/en/events?view=list')).length).toBeLessThanOrEqual(35);
    expect((await prefetchesOf(page, '/en/dashboard')).length).toBeLessThanOrEqual(25);
  });

  test('a page counted is a page that prefetches: the count is not blind', async ({ as }) => {
    const page = await as('member', { viewport: { width: 1280, height: 900 } });
    // The dashboard links to the menu entries and to its events: some prefetch must be seen, or the counting is broken.
    expect((await prefetchesOf(page, '/en/dashboard')).length).toBeGreaterThan(0);
  });
});
